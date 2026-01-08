const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { User, PasswordResetToken, OTP, Token } = require('../models/User');
const LeaveRequest = require('../models/LeaveRequest');
const Department = require('../models/Department');
const DoctorSchedule = require('../models/DoctorSchedule');
const Feedback = require('../models/Feedback');

// Schedule Request Schema (in-memory for now, can be moved to a separate model later)
// Using global to share with doctor routes
const { transporter } = require('../config/email');
const { extractToken } = require('../middleware/authMiddleware');
const cronService = require('../services/cronService');

const router = express.Router();

// Helper to resolve patient by patientId (string like P001) or by Mongo ObjectId
const isValidObjectId = (id) => {
  try {
    return mongoose.Types.ObjectId.isValid(id);
  } catch { return false; }
};

async function findPatientByAnyId(patientIdParam) {
  const or = [{ patientId: patientIdParam }];
  if (isValidObjectId(patientIdParam)) {
    or.push({ _id: patientIdParam });
  }
  return await User.findOne({ role: 'patient', $or: or }).select('-password');
}

// Admin middleware to check if user is admin
const adminMiddleware = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Check if user is admin using role field
    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// Generate temporary password
const generateTempPassword = () => {
  return crypto.randomBytes(8).toString('hex');
};

// Send account credentials email
const sendAccountCredentialsEmail = async (email, password, role, name) => {
  const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`;
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: `Your MediQ ${role} login details`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">Welcome to MediQ</h2>
        <p>Hello ${name},</p>
        <p>Your ${role} account has been created. Here are your login credentials:</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> ${password}</p>
          <p><strong>Role:</strong> ${role}</p>
        </div>
        
        <p>Please login and change your password immediately:</p>
        <a href="${loginUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Login to MediQ</a>
        
        <p style="margin-top: 20px; color: #666; font-size: 14px;">
          For security reasons, please change your password after your first login.
        </p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
};

// Get users with basic filtering and pagination (Admin only)
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const { q = '', role = '', page = 1, limit = 10 } = req.query;

    const query = {};
    if (q) {
      const regex = new RegExp(q, 'i');
      query.$or = [{ name: regex }, { email: regex }];
    }
    if (role) {
      query.role = role;
    }

    const pageNum = Math.max(1, parseInt(page));
    const pageSize = Math.max(1, Math.min(1000, parseInt(limit)));

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize);

    res.json({ users, total, page: pageNum, limit: pageSize });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Patch user status/role (Admin only)
router.patch('/users/:id', adminMiddleware, async (req, res) => {
  try {
    const { status, role } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (role && ['patient', 'doctor', 'receptionist', 'admin'].includes(role)) {
      user.role = role;
    }

    if (status && ['active', 'inactive'].includes(status)) {
      user.status = status;
      user.isActive = status === 'active';

      // Send notification email to user on deactivate/activate
      try {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: user.email,
          subject: status === 'inactive' ? 'Your MediQ account has been deactivated' : 'Your MediQ account has been reactivated',
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:24px;">
              <h2 style="margin:0 0 16px;color:#111;">${status === 'inactive' ? 'Account Deactivated' : 'Account Reactivated'}</h2>
              <p style="color:#333;line-height:1.6;">Hello ${user.name || 'User'},</p>
              ${status === 'inactive' ? `
                <p style="color:#444;line-height:1.6;">Your account has been deactivated by the administrator. You will not be able to sign in until your account is reactivated.</p>
                <p style="color:#444;line-height:1.6;">If you believe this is a mistake or need assistance, please contact our support team.</p>
              ` : `
                <p style="color:#444;line-height:1.6;">Your account has been reactivated. You can now sign in and continue using MediQ.</p>
              `}
              <p style="margin-top:24px;color:#666;font-size:12px;">This is an automated message. Please do not reply.</p>
            </div>
          `
        };
        await transporter.sendMail(mailOptions);
      } catch (mailErr) {
        console.error('Deactivation email send failed:', mailErr.message);
      }
    }

    await user.save();
    const updated = await User.findById(user._id).select('-password');
    res.json(updated);
  } catch (error) {
    console.error('Patch user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get doctors
router.get('/doctors', adminMiddleware, async (req, res) => {
  try {
    const doctors = await User.find({ role: 'doctor' })
      .select('-password')
      .populate('doctor_info.department', 'name description')
      .sort({ createdAt: -1 });
    res.json(doctors);
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single doctor with populated details
router.get('/doctors/:id', adminMiddleware, async (req, res) => {
  try {
    const doctor = await User.findOne({ _id: req.params.id, role: 'doctor' })
      .select('-password')
      .populate('doctor_info.department', 'name description');

    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    res.json(doctor);
  } catch (error) {
    console.error('Get doctor by id error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user by ID (Admin only)
router.get('/users/:id', adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userWithRole = {
      ...user.toObject(),
      role: user.email === process.env.ADMIN_EMAIL ? 'admin' : user.role
    };

    res.json(userWithRole);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user (Admin only)
router.put('/users/:id', adminMiddleware, async (req, res) => {
  try {
    const { name, email, phone, isVerified } = req.body;
    
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (typeof isVerified === 'boolean') user.isVerified = isVerified;

    await user.save();

    const updatedUser = await User.findById(user._id).select('-password');
    const userWithRole = {
      ...updatedUser.toObject(),
      role: updatedUser.email === process.env.ADMIN_EMAIL ? 'admin' : updatedUser.role
    };

    res.json(userWithRole);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete user (Admin only)
router.delete('/users/:id', adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent admin from deleting themselves
    if (user.email === process.env.ADMIN_EMAIL) {
      return res.status(400).json({ message: 'Cannot delete admin user' });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get dashboard statistics (Admin only)
router.get('/stats', adminMiddleware, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({});
    const totalDoctors = await User.countDocuments({ role: 'doctor' });
    const totalPatients = await User.countDocuments({ role: 'patient' });
    const verifiedUsers = await User.countDocuments({ isVerified: true });
    const recentUsers = await User.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });

    // Get real appointment data from Token model
    const totalAppointments = await Token.countDocuments({});
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayAppointments = await Token.countDocuments({
      booking_date: { $gte: today, $lt: tomorrow }
    });
    
    const pendingAppointments = await Token.countDocuments({
      status: { $in: ['booked', 'in_queue'] }
    });
    
    const completedAppointments = await Token.countDocuments({
      status: 'consulted'
    });

    res.json({
      totalUsers,
      totalDoctors,
      totalPatients,
      totalAppointments,
      recentActivity: recentUsers,
      users: {
        total: totalUsers,
        verified: verifiedUsers,
        recent: recentUsers,
        unverified: totalUsers - verifiedUsers
      },
      appointments: {
        total: totalAppointments,
        today: todayAppointments,
        pending: pendingAppointments,
        completed: completedAppointments
      },
      systemHealth: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get appointment statistics for charts (Admin only)
router.get('/appointment-stats', adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter.booking_date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Get appointment counts by status
    const statusCounts = await Token.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get daily appointment trends (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const dailyTrends = await Token.aggregate([
      {
        $match: {
          booking_date: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$booking_date' } }
          },
          appointments: { $sum: 1 },
          newPatients: {
            $sum: {
              $cond: [{ $eq: ['$created_by', 'patient'] }, 1, 0]
            }
          }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    // Format the response
    const stats = {
      statusCounts: statusCounts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      dailyTrends: dailyTrends.map(day => ({
        date: day._id.date,
        appointments: day.appointments,
        newPatients: day.newPatients
      }))
    };

    res.json(stats);
  } catch (error) {
    console.error('Get appointment stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// List all appointments with patient/family and doctor details (Admin only)
router.get('/appointments', adminMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      doctorId = '',
      startDate = '',
      endDate = '',
      search = '',
      sortBy = 'date', // date|time|status|token
      sortDir = 'desc' // asc|desc
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const pageSize = Math.max(1, Math.min(200, parseInt(limit)));

    const query = {};
    if (status) query.status = status;
    if (doctorId) query.doctor_id = doctorId;
    if (startDate && endDate) {
      query.booking_date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    // Basic server-side search across token, symptoms, and patient name/email/phone
    if (search) {
      const or = [
        { token_number: { $regex: search, $options: 'i' } },
        { symptoms: { $regex: search, $options: 'i' } }
      ];
      try {
        const users = await User.find({
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } }
          ]
        }).select('_id');
        const userIds = users.map(u => u._id);
        if (userIds.length) {
          or.push({ patient_id: { $in: userIds } });
        }
      } catch (_) {}
      query.$or = or;
    }

    const total = await Token.countDocuments(query);

    // Sorting map
    const sortMap = {
      date: 'booking_date',
      time: 'time_slot',
      status: 'status',
      token: 'token_number'
    };
    const sortField = sortMap[sortBy] || 'booking_date';
    const sortOrder = String(sortDir).toLowerCase() === 'asc' ? 1 : -1;

    const appointments = await Token.find(query)
      .sort({ [sortField]: sortOrder, createdAt: -1 })
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .populate('patient_id', 'name email phone patientId')
      .populate('family_member_id', 'name relation patientId')
      .populate({
        path: 'doctor_id',
        select: 'name doctor_info',
        populate: { path: 'doctor_info.department', select: 'name' }
      });

    const rows = appointments.map(apt => ({
      id: apt._id,
      patientId: apt.family_member_id?.patientId || apt.patient_id?.patientId || null,
      patient_id: apt.patient_id?._id || null,
      patientName: apt.family_member_id?.name || apt.patient_id?.name || 'Unknown',
      patientEmail: apt.patient_id?.email || '',
      patientPhone: apt.patient_id?.phone || '',
      linkedAccount: apt.family_member_id ? (apt.patient_id?.name || 'Main Account') : '',
      doctor: apt.doctor_id?.name || 'Unknown',
      doctor_id: apt.doctor_id?._id || null,
      department: apt.department || apt.doctor_id?.doctor_info?.department?.name || 'Unknown',
      date: apt.booking_date,
      time: apt.time_slot || '',
      tokenNumber: apt.token_number || '',
      status: apt.status || 'booked'
    }));

    res.json({ appointments: rows, total, page: pageNum, limit: pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (error) {
    console.error('Admin list appointments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get full details for a specific appointment, including patient/family details
router.get('/appointments/:id/details', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    function buildFileUrl(path) {
      if (!path) return '';
      if (typeof path !== 'string') return '';
      if (path.startsWith('http://') || path.startsWith('https://')) return path;
      const base = process.env.PUBLIC_BASE_URL || `http://localhost:5001`;
      if (path.startsWith('/')) return `${base}${path}`;
      return `${base}/${path}`;
    }

  const apt = await Token.findById(id)
      .populate('patient_id', 'name email phone gender age patientId address dob bloodGroup profile_photo profileImage')
      .populate('family_member_id', 'name relation age gender bloodGroup phone patientId')
      .populate({
        path: 'doctor_id',
        select: 'name doctor_info',
        populate: { path: 'doctor_info.department', select: 'name' }
      });

    if (!apt) return res.status(404).json({ message: 'Appointment not found' });

    const appointment = {
      id: apt._id,
      date: apt.booking_date,
      time: apt.time_slot || '',
      status: apt.status,
      tokenNumber: apt.token_number || '',
      department: apt.department || apt.doctor_id?.doctor_info?.department?.name || 'Unknown',
      doctor: apt.doctor_id?.name || 'Unknown',
      symptoms: apt.symptoms || ''
    };

    const isFamily = !!apt.family_member_id;
    const patient = isFamily ? {
      type: 'family_member',
      name: apt.family_member_id?.name || '',
      relation: apt.family_member_id?.relation || '',
      phone: apt.family_member_id?.phone || apt.patient_id?.phone || '',
      email: apt.patient_id?.email || '',
      gender: apt.family_member_id?.gender || '',
      age: typeof apt.family_member_id?.age === 'number' ? apt.family_member_id.age : '',
      bloodGroup: apt.family_member_id?.bloodGroup || '',
      patientCode: apt.family_member_id?.patientId || null,
      profilePhoto: apt.patient_id?.profile_photo || apt.patient_id?.profileImage || '',
      profilePhotoUrl: buildFileUrl(apt.patient_id?.profile_photo || apt.patient_id?.profileImage || ''),
      primaryAccount: {
        name: apt.patient_id?.name || '',
        email: apt.patient_id?.email || '',
        phone: apt.patient_id?.phone || '',
        patientCode: apt.patient_id?.patientId || null
      }
    } : {
      type: 'patient',
      name: apt.patient_id?.name || '',
      email: apt.patient_id?.email || '',
      phone: apt.patient_id?.phone || '',
      gender: apt.patient_id?.gender || '',
      age: typeof apt.patient_id?.age === 'number' ? apt.patient_id.age : '',
      dob: apt.patient_id?.dob || null,
      bloodGroup: apt.patient_id?.bloodGroup || '',
      address: apt.patient_id?.address || '',
      patientCode: apt.patient_id?.patientId || null,
      profilePhoto: apt.patient_id?.profile_photo || apt.patient_id?.profileImage || '',
      profilePhotoUrl: buildFileUrl(apt.patient_id?.profile_photo || apt.patient_id?.profileImage || '')
    };

    return res.json({ appointment, patient });
  } catch (error) {
    console.error('Get appointment details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update appointment status (Admin)
router.patch('/appointments/:id', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['booked', 'in_queue', 'consulted', 'cancelled', 'missed'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const appointment = await Token.findByIdAndUpdate(
      id,
      {
        status,
        ...(notes ? { admin_notes: notes } : {}),
        updatedAt: new Date(),
      },
      { new: true }
    )
      .populate('patient_id', 'name email phone')
      .populate({
        path: 'doctor_id',
        select: 'name doctor_info',
        populate: { path: 'doctor_info.department', select: 'name' }
      });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    res.json({
      message: 'Appointment status updated successfully',
      appointment: {
        id: appointment._id,
        patientName: appointment.patient_id?.name || 'Unknown',
        doctor: appointment.doctor_id?.name || 'Unknown',
        department: appointment.department || appointment.doctor_id?.doctor_info?.department?.name || 'Unknown',
        date: appointment.booking_date,
        time: appointment.time_slot,
        status: appointment.status
      }
    });
  } catch (error) {
    console.error('Admin update appointment status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get doctor load analytics (Admin only)
router.get('/doctor-load-analytics', adminMiddleware, async (req, res) => {
  try {
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({ message: 'Date parameter is required' });
    }

    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Get all doctors
    const doctors = await User.find({ role: 'doctor' })
      .select('_id name doctor_info')
      .populate('doctor_info.department', 'name');

    const analytics = [];

    for (const doctor of doctors) {
      // Get appointments for this doctor on the selected date
      const appointments = await Token.find({
        doctor_id: doctor._id,
        booking_date: { $gte: selectedDate, $lt: nextDay },
        status: { $in: ['booked', 'in_queue', 'consulted'] }
      });

      // Calculate session breakdown
      const morningAppointments = appointments.filter(apt => apt.time_slot === '09:00').length;
      const afternoonAppointments = appointments.filter(apt => apt.time_slot === '14:00').length;
      const totalAppointments = appointments.length;

      // Calculate auto-assigned vs manual
      const autoAssignedCount = appointments.filter(apt => apt.created_by === 'patient' && apt.auto_assigned).length;
      const manualAssignedCount = totalAppointments - autoAssignedCount;

      // Calculate average wait time (mock calculation)
      const avgWaitTime = totalAppointments > 0 ? Math.round(15 + (totalAppointments * 2)) : 0;

      analytics.push({
        doctorId: doctor._id,
        doctorName: doctor.name,
        department: doctor.doctor_info?.department?.name || 'General',
        totalAppointments,
        morningAppointments,
        afternoonAppointments,
        autoAssignedCount,
        manualAssignedCount,
        avgWaitTime
      });
    }

    // Sort by total appointments (descending)
    analytics.sort((a, b) => b.totalAppointments - a.totalAppointments);

    res.json({ analytics });
  } catch (error) {
    console.error('Get doctor load analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get recent activity (Admin only)
router.get('/activity', adminMiddleware, async (req, res) => {
  try {
    // Get recent users
    const recentUsers = await User.find({})
      .select('name email createdAt')
      .sort({ createdAt: -1 })
      .limit(10);

    // Get recent password resets
    const recentResets = await PasswordResetToken.find({})
      .select('email createdAt used')
      .sort({ createdAt: -1 })
      .limit(5);

    const activities = [];

    // Add user registrations
    recentUsers.forEach(user => {
      activities.push({
        type: 'user_registration',
        description: `New user registered: ${user.name}`,
        user: user.name,
        email: user.email,
        timestamp: user.createdAt
      });
    });

    // Add password reset activities
    recentResets.forEach(reset => {
      activities.push({
        type: 'password_reset',
        description: `Password reset ${reset.used ? 'completed' : 'requested'}`,
        user: reset.email,
        email: reset.email,
        timestamp: reset.createdAt
      });
    });

    // Sort by timestamp and limit
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limitedActivities = activities.slice(0, 20);

    res.json(limitedActivities);
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// System health check (Admin only)
router.get('/health', adminMiddleware, async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
      database: 'connected', // You can add actual DB health check here
      services: {
        email: 'operational',
        authentication: 'operational',
        api: 'operational'
      }
    };

    res.json(health);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/patients', adminMiddleware, async (req, res) => {
  try {
    // Get all main account patients
    const mainPatients = await User.find({ role: 'patient' })
      .select('-password')
      .sort({ createdAt: -1 });
    
    // Get all family members who have appointments
    const familyMembers = await mongoose.model('FamilyMember').find({});
    
    // Get all unique patient IDs from appointments (both main accounts and family members)
    const appointments = await mongoose.model('Token').find({});
    const allPatientIds = new Set();
    
    appointments.forEach(apt => {
      if (apt.patient_id) allPatientIds.add(apt.patient_id.toString());
      if (apt.family_member_id) allPatientIds.add(apt.family_member_id.toString());
    });
    
    // Create enhanced patients list
    const enhancedPatients = [];
    
    // Process main account patients
    for (const patient of mainPatients) {
      const familyMembersList = await mongoose.model('FamilyMember').find({ patient_id: patient._id });
      const hasFamilyMembers = familyMembersList.length > 0;
      const blockHistory = patient.blockHistory || [];
      
      // Check if this patient has any appointments
      const hasAppointments = allPatientIds.has(patient._id.toString());
      
      enhancedPatients.push({
        ...patient.toObject(),
        hasFamilyMembers,
        blockHistory,
        hasAppointments,
        isMainAccount: true
      });
    }
    
    // Process family members who have appointments but aren't main account holders
    for (const familyMember of familyMembers) {
      // Check if this family member has appointments
      const hasAppointments = allPatientIds.has(familyMember._id.toString());
      
      if (hasAppointments) {
        // Check if we already have this family member as a main account
        const isMainAccount = mainPatients.some(p => p._id.toString() === familyMember._id.toString());
        
        if (!isMainAccount) {
          // Create a patient object for this family member
          const familyPatient = {
            _id: familyMember._id,
            patientId: familyMember.patientId || `FM${familyMember._id.toString().slice(-6)}`,
            name: familyMember.name,
            email: familyMember.email || '',
            phone: familyMember.phone || '',
            age: familyMember.age,
            gender: familyMember.gender,
            address: familyMember.address || '',
            bloodGroup: familyMember.bloodGroup || '',
            allergies: familyMember.allergies || '',
            chronicConditions: familyMember.chronicConditions || '',
            emergencyContact: familyMember.emergency_contact || {},
            profile_photo: familyMember.profile_photo || '',
            isBlocked: familyMember.isBlocked || false,
            blockReason: familyMember.blockReason || '',
            blockHistory: familyMember.blockHistory || [],
            createdAt: familyMember.createdAt || new Date(),
            updatedAt: familyMember.updatedAt || new Date(),
            hasFamilyMembers: false,
            hasAppointments: true,
            isMainAccount: false,
            relation: familyMember.relation,
            parentPatientId: familyMember.patient_id
          };
          
          enhancedPatients.push(familyPatient);
        }
      }
    }
    
    // Sort by creation date (newest first)
    enhancedPatients.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json(enhancedPatients);
  } catch (err) {
    console.error('Get patients error:', err);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Registered patients (main accounts with family member counts)
router.get('/registered-patients', adminMiddleware, async (req, res) => {
  try {
    const mainPatients = await User.find({ role: 'patient' })
      .select('_id name email phone createdAt patientId patient_info')
      .sort({ createdAt: -1 });

    const FamilyMember = mongoose.model('FamilyMember');
    const families = await FamilyMember.aggregate([
      { $group: { _id: '$patient_id', count: { $sum: 1 } } }
    ]);
    const familyMap = new Map(families.map(f => [String(f._id), f.count]));

    const patients = mainPatients.map(p => ({
      _id: p._id,
      patientId: p.patientId || `P${String(p._id).slice(-6).toUpperCase()}`,
      regId: p.patientId || p._id,
      name: p.name,
      email: p.email || '',
      phone: p.phone || '',
      createdAt: p.createdAt,
      familyCount: familyMap.get(String(p._id)) || 0
    }));

    res.json({ patients });
  } catch (error) {
    console.error('Get registered patients error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single patient details
router.get('/patients/:patientId', adminMiddleware, async (req, res) => {
  try {
    const { patientId } = req.params;
    console.log('🔍 Admin API - Fetching patient with ID:', patientId);
    
    // Fix: Call select on the query, not the result
    const or = [{ patientId: patientId }];
    if (mongoose.Types.ObjectId.isValid(patientId)) {
      or.push({ _id: patientId });
    }
    const patient = await User.findOne({ role: 'patient', $or: or }).select('-password');
    
    console.log('📊 Admin API - Patient found:', patient ? 'Yes' : 'No');
    if (patient) {
      console.log('📊 Admin API - Patient details:', {
        _id: patient._id,
        patientId: patient.patientId,
        name: patient.name,
        email: patient.email
      });
    }
    
    if (!patient) {
      console.log('❌ Admin API - Patient not found for ID:', patientId);
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    // Get family members
    const familyMembers = await mongoose.model('FamilyMember').find({ patient_id: patient._id });
    
    res.json({
      ...patient.toObject(),
      familyMembers
    });
  } catch (error) {
    console.error('Get patient details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient history (bookings, cancellations, etc.)
router.get('/patients/:patientId/history', adminMiddleware, async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Find patient
    const patient = await findPatientByAnyId(patientId);
    
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    // Get appointments (populate doctor, department, and family member)
    const appointments = await mongoose.model('Token').find({ 
      patient_id: patient._id 
    })
      .populate('doctor_id', 'name')
      .populate('family_member_id', 'name relation patientId')
      .sort({ createdAt: -1 });
    
    const now = new Date();
    const upcoming = appointments.filter(apt => new Date(apt.booking_date) >= now);
    const past = appointments.filter(apt => new Date(apt.booking_date) < now);
    
    // Get cancellations
    const cancellations = appointments.filter(apt => apt.status === 'cancelled');
    
    res.json({
      upcoming: upcoming.map(apt => ({
        id: apt._id,
        doctorName: apt.doctor_id?.name || 'Unknown',
        departmentName: apt.department || 'Unknown',
        appointmentDate: apt.booking_date,
        appointmentTime: apt.time_slot,
        status: apt.status,
        tokenNumber: apt.token_number,
        familyMemberId: apt.family_member_id?._id || null,
        familyMemberName: apt.family_member_id?.name || null,
        familyMemberRelation: apt.family_member_id?.relation || null
      })),
      past: past.map(apt => ({
        id: apt._id,
        doctorName: apt.doctor_id?.name || 'Unknown',
        departmentName: apt.department || 'Unknown',
        appointmentDate: apt.booking_date,
        outcome: apt.status === 'consulted' ? 'Completed' : (apt.status === 'missed' ? 'No-show' : apt.status),
        familyMemberId: apt.family_member_id?._id || null,
        familyMemberName: apt.family_member_id?.name || null,
        familyMemberRelation: apt.family_member_id?.relation || null
      })),
      cancellations: cancellations.map(apt => ({
        id: apt._id,
        cancelledDate: apt.cancelled_at || apt.updatedAt,
        reason: apt.cancellation_reason || 'No reason provided',
        familyMemberId: apt.family_member_id?._id || null,
        familyMemberName: apt.family_member_id?.name || null,
        familyMemberRelation: apt.family_member_id?.relation || null
      }))
    });
  } catch (error) {
    console.error('Get patient history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient family members
router.get('/patients/:patientId/family', adminMiddleware, async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Find patient
    const patient = await findPatientByAnyId(patientId);
    
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    // Get family members
    const familyMembers = await mongoose.model('FamilyMember').find({ patient_id: patient._id });
    
    res.json({ familyMembers });
  } catch (error) {
    console.error('Get patient family error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Toggle family member active status (Admin)
router.put('/patients/:patientId/family/:memberId/block', adminMiddleware, async (req, res) => {
  try {
    const { patientId, memberId } = req.params;
    const { active } = req.body;

    const patient = await findPatientByAnyId(patientId);

    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const FamilyMember = mongoose.model('FamilyMember');
    const member = await FamilyMember.findOne({ _id: memberId, patient_id: patient._id });
    if (!member) {
      return res.status(404).json({ message: 'Family member not found' });
    }

    member.isActive = active !== false;
    await member.save();

    res.json({ message: `Family member ${member.isActive ? 'activated' : 'deactivated'} successfully` });
  } catch (error) {
    console.error('Toggle family member active error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Block/Unblock patient
router.put('/patients/:patientId/block', adminMiddleware, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { blocked, reason } = req.body;
    
    const patient = await findPatientByAnyId(patientId);
    
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    // Update patient status
    patient.isBlocked = blocked;
    if (blocked && reason) {
      patient.blockReason = reason;
      // Add to block history
      if (!patient.blockHistory) {
        patient.blockHistory = [];
      }
      patient.blockHistory.push({
        reason,
        blockedAt: new Date(),
        blockedBy: req.user._id
      });
    } else if (!blocked) {
      patient.blockReason = '';
    }
    
    await patient.save();
    
    res.json({ 
      message: `Patient ${blocked ? 'blocked' : 'unblocked'} successfully`,
      patient: {
        patientId: patient.patientId,
        name: patient.name,
        isBlocked: patient.isBlocked,
        blockReason: patient.blockReason
      }
    });
  } catch (error) {
    console.error('Block/Unblock patient error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update patient information
router.put('/patients/:patientId', adminMiddleware, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { name, email, phone } = req.body;
    
    const patient = await findPatientByAnyId(patientId);
    
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    // Update allowed fields only
    if (name) patient.name = name;
    if (email) patient.email = email;
    if (phone) patient.phone = phone;
    
    await patient.save();
    
    res.json({ 
      message: 'Patient updated successfully',
      patient: {
        patientId: patient.patientId,
        name: patient.name,
        email: patient.email,
        phone: patient.phone
      }
    });
  } catch (error) {
    console.error('Update patient error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Cancel an appointment for a patient
router.put('/patients/:patientId/appointments/:appointmentId/cancel', adminMiddleware, async (req, res) => {
  try {
    const { patientId, appointmentId } = req.params;
    const { reason } = req.body;

    // Resolve patient
    const patient = await User.findOne({
      role: 'patient',
      $or: [
        { patientId: patientId },
        { _id: patientId }
      ]
    });
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const Token = mongoose.model('Token');
    const appointment = await Token.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Ensure appointment belongs to patient (main or family)
    const isOwnedByPatient = appointment.patient_id?.toString() === patient._id.toString();
    if (!isOwnedByPatient) {
      return res.status(403).json({ message: 'Appointment does not belong to this patient' });
    }

    // Update status
    appointment.status = 'cancelled_by_hospital';
    appointment.cancellation_reason = reason || 'Cancelled by admin';
    appointment.cancelled_by = 'admin';
    appointment.cancelled_at = new Date();

    // Auto-refund if payment made online/cashless
    if (appointment.payment_status === 'paid') {
      appointment.payment_status = 'refunded';
      appointment.refund_reason = `Auto-refund: ${appointment.cancellation_reason}`;
      appointment.refunded_at = new Date();
      appointment.refund_amount = appointment.fee || 500;
      // Preserve original method when present; fall back to 'original'
      appointment.refund_method = appointment.paymentMethod || 'original';
      try {
        const notificationService = require('../services/notificationService');
        await notificationService.sendRefundNotification({
          patientName: appointment.patient_id?.name || 'Patient',
          patientEmail: appointment.patient_id?.email,
          amount: appointment.refund_amount,
          reason: appointment.refund_reason,
          appointmentDate: appointment.booking_date,
          doctorName: appointment.doctor_id?.name || 'Doctor'
        });
      } catch (e) {
        console.error('Failed to send auto-refund notification:', e);
      }
    }

    await appointment.save();

    // Send WhatsApp cancellation confirmation
    const whatsappBotService = require('../services/whatsappBotService');
    const refundInfo = {
      eligible: appointment.payment_status === 'refunded',
      amount: appointment.refund_amount || 0,
      method: appointment.refund_method || 'original',
      status: appointment.payment_status === 'refunded' ? 'processed' : 'none'
    };
    whatsappBotService.sendCancellationConfirmation(appointment._id, refundInfo).then(() => {
      console.log('✅ WhatsApp cancellation confirmation sent successfully');
    }).catch((error) => {
      console.error('❌ Error sending WhatsApp cancellation confirmation:', error);
    });

    // Realtime sync
    try {
      const io = req.app.get('io');
      if (io) {
        io.to('admin').emit('appointment-status-changed', { id: appointment._id, status: appointment.status, payment_status: appointment.payment_status });
        io.to('patient').emit('your-appointment-updated', { id: appointment._id, status: appointment.status, payment_status: appointment.payment_status });
        io.to('doctor').emit('appointment-status-changed', { id: appointment._id, status: appointment.status, payment_status: appointment.payment_status });
      }
    } catch (e) {
      console.error('Realtime emit error (admin cancel):', e);
    }

    res.json({ message: 'Appointment cancelled and synced successfully' });
  } catch (error) {
    console.error('Admin cancel appointment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Reschedule an appointment for a patient
router.put('/patients/:patientId/appointments/:appointmentId/reschedule', adminMiddleware, async (req, res) => {
  try {
    const { patientId, appointmentId } = req.params;
    const { appointmentDate, appointmentTime } = req.body;

    if (!appointmentDate || !appointmentTime) {
      return res.status(400).json({ message: 'appointmentDate and appointmentTime are required' });
    }

    // Resolve patient
    const patient = await User.findOne({
      role: 'patient',
      $or: [
        { patientId: patientId },
        { _id: patientId }
      ]
    });
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const Token = mongoose.model('Token');
    const appointment = await Token.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Ensure appointment belongs to patient (main or family)
    const isOwnedByPatient = appointment.patient_id?.toString() === patient._id.toString();
    if (!isOwnedByPatient) {
      return res.status(403).json({ message: 'Appointment does not belong to this patient' });
    }

    // Store old date and time for WhatsApp message
    const oldDate = new Date(appointment.booking_date).toLocaleDateString();
    const oldTime = appointment.time_slot;

    // Apply new schedule
    appointment.booking_date = new Date(appointmentDate);
    appointment.time_slot = appointmentTime;
    if (appointment.status === 'cancelled') {
      appointment.status = 'booked';
      appointment.cancellation_reason = '';
      appointment.cancelled_at = undefined;
      appointment.cancelled_by = undefined;
    }
    await appointment.save();

    // Send WhatsApp rescheduling confirmation
    const whatsappBotService = require('../services/whatsappBotService');
    whatsappBotService.sendReschedulingConfirmation(appointment._id, oldDate, oldTime).then(() => {
      console.log('✅ WhatsApp rescheduling confirmation sent successfully');
    }).catch((error) => {
      console.error('❌ Error sending WhatsApp rescheduling confirmation:', error);
    });

    res.json({ message: 'Appointment rescheduled successfully' });
  } catch (error) {
    console.error('Admin reschedule appointment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Assign another doctor for a patient's appointment
router.put('/patients/:patientId/appointments/:appointmentId/assign-doctor', adminMiddleware, async (req, res) => {
  try {
    const { patientId, appointmentId } = req.params;
    const { doctorId } = req.body;

    if (!doctorId) {
      return res.status(400).json({ message: 'doctorId is required' });
    }

    // Resolve patient
    const patient = await User.findOne({
      role: 'patient',
      $or: [
        { patientId: patientId },
        { _id: patientId }
      ]
    });
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Validate doctor
    const doctor = await User.findById(doctorId).select('name role doctor_info');
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const Token = mongoose.model('Token');
    const appointment = await Token.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Ensure appointment belongs to patient (main or family captured by patient_id)
    const isOwnedByPatient = appointment.patient_id?.toString() === patient._id.toString();
    if (!isOwnedByPatient) {
      return res.status(403).json({ message: 'Appointment does not belong to this patient' });
    }

    // Assign doctor and optionally update department if blank
    appointment.doctor_id = doctor._id;
    if (!appointment.department && doctor.doctor_info?.department) {
      // Persist department name for convenience if present on doctor
      appointment.department = doctor.doctor_info.department.name || appointment.department;
    }
    await appointment.save();

    res.json({ message: 'Doctor reassigned successfully' });
  } catch (error) {
    console.error('Admin assign doctor error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Export patient history (CSV)
router.get('/patients/:patientId/history/export', adminMiddleware, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { includeFamily = 'false' } = req.query;

    const patient = await User.findOne({
      role: 'patient',
      $or: [
        { patientId: patientId },
        { _id: patientId }
      ]
    });
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const Token = mongoose.model('Token');

    let query = { patient_id: patient._id };
    if (includeFamily === 'true') {
      // Include family members linked to this patient
      const FamilyMember = mongoose.model('FamilyMember');
      const members = await FamilyMember.find({ patient_id: patient._id }).select('_id');
      const memberIds = members.map(m => m._id);
      query = { $or: [ { patient_id: patient._id }, { family_member_id: { $in: memberIds } } ] };
    }

    const appointments = await Token.find(query)
      .populate('doctor_id', 'name')
      .populate('family_member_id', 'name relation patientId')
      .sort({ createdAt: -1 });

    const rows = [
      ['Type','Doctor','Department','Date','Time','Status','Token','For','Relation','Cancellation Reason']
    ];

    appointments.forEach(apt => {
      const type = new Date(apt.booking_date) >= new Date() ? 'Upcoming' : (apt.status === 'cancelled' ? 'Cancelled' : 'Past');
      rows.push([
        type,
        apt.doctor_id?.name || 'Unknown',
        apt.department || 'Unknown',
        apt.booking_date ? new Date(apt.booking_date).toISOString() : '',
        apt.time_slot || '',
        apt.status || '',
        apt.token_number || '',
        apt.family_member_id?.name || '',
        apt.family_member_id?.relation || '',
        apt.cancellation_reason || ''
      ]);
    });

    const csv = rows.map(r => r.map(v => (v === null || v === undefined) ? '' : `${String(v).replace(/"/g, '""')}`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=patient_${patient.patientId || patient._id}_history.csv`);
    return res.send(csv);
  } catch (error) {
    console.error('Admin export history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



// Update doctor
router.put('/doctors/:id', adminMiddleware, async (req, res) => {
  try {
    const { name, email, phone, doctor_info } = req.body;
    
    const doctor = await User.findById(req.params.id);
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    // Check if email is being changed and if it already exists
    if (email !== doctor.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: req.params.id } });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already exists' });
      }
    }

    // Update doctor information
    const updatedDoctor = await User.findByIdAndUpdate(
      req.params.id,
      {
        name,
        email,
        phone,
        doctor_info: {
          ...doctor.doctor_info,
          ...doctor_info
        }
      },
      { new: true }
    ).populate('doctor_info.department', 'name description');

    res.json({ 
      message: 'Doctor updated successfully',
      doctor: updatedDoctor
    });
  } catch (error) {
    console.error('Update doctor error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete doctor
router.delete('/doctors/:id', adminMiddleware, async (req, res) => {
  try {
    const doctor = await User.findById(req.params.id);
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Doctor deleted successfully' });
  } catch (error) {
    console.error('Delete doctor error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send verification email to doctor (Admin only)
router.post('/send-doctor-verification', adminMiddleware, async (req, res) => {
  try {
    const { email, name, role = 'doctor' } = req.body;

    if (!email || !name) {
      return res.status(400).json({ message: 'Email and name are required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Delete any existing OTPs for this email
    await OTP.deleteMany({ email, type: 'registration' });

    // Save new OTP
    const otpDoc = new OTP({
      email,
      otp,
      type: 'registration'
    });
    await otpDoc.save();

    // Send verification email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `MediQ ${role} Account Verification`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">MediQ Account Verification</h2>
          <p>Hello ${name},</p>
          <p>An admin has created a ${role} account for you at MediQ. To verify your email and activate your account, please use the following verification code:</p>

          <div style="background-color: #f0f0f0; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
            ${otp}
          </div>

          <p>This verification code will expire in 10 minutes.</p>
          <p>If you didn't expect this email, please ignore it.</p>

          <p style="margin-top: 20px; color: #666; font-size: 14px;">
            After verification, you will receive your login credentials.
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({
      message: `Verification email sent to ${email}. Please ask the ${role} to verify their email.`,
      email: email
    });

  } catch (error) {
    console.error('Send doctor verification error:', error);
    res.status(500).json({ message: 'Failed to send verification email' });
  }
});

// Create user (Admin only) - Direct creation without OTP
router.post('/users', adminMiddleware, async (req, res) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      role, 
      department, 
      specialization, 
      experience_years, 
      consultation_fee,
      video_fee,
      followup_fee,
      qualifications,
      certifications,
      license_number,
      bio,
      consultation_type,
      slot_duration,
      employment_type,
      active_days,
      status
    } = req.body;

    console.log('Received doctor creation request:', { 
      name, email, phone, role, department, specialization, 
      experience_years, consultation_fee, qualifications, bio 
    });

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ message: 'Name and email are required' });
    }

    // Validate role
    if (!['doctor', 'receptionist'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Only doctor and receptionist can be created.' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Generate temporary password
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    // Create user object with role-specific info
    const userData = {
      name,
      email,
      password: hashedPassword,
      phone: phone || '',
      role,
      isVerified: true
    };

    // Validate department exists if provided
    if (department) {
      const departmentExists = await Department.findById(department);
      if (!departmentExists) {
        return res.status(400).json({ message: 'Invalid department selected' });
      }
    }

    // Add role-specific nested fields
    if (role === 'doctor') {
      userData.doctor_info = {
        department: department || null,
        specialization: specialization || '',
        experience_years: parseInt(experience_years) || 0,
        consultation_fee: parseInt(consultation_fee) || 500,
        video_fee: parseInt(video_fee) || 0,
        followup_fee: parseInt(followup_fee) || 0,
        qualifications: qualifications || '',
        certifications: certifications || '',
        license_number: license_number || '',
        bio: bio || '',
        calendar: [],
        status: status === 'inactive' ? 'inactive' : (status === 'pending' ? 'pending' : 'active'),
        consultation_type: consultation_type || 'physical',
        default_working_hours: {
          start_time: '09:00',
          end_time: '17:00'
        },
        default_break_time: {
          start_time: '13:00',
          end_time: '14:00'
        },
        default_slot_duration: parseInt(slot_duration) || 30,
        employment_type: employment_type || 'full-time',
        active_days: Array.isArray(active_days) && active_days.length ? active_days : ['Mon','Tue','Wed','Thu','Fri']
      };
    } else if (role === 'receptionist') {
      userData.receptionist_info = {
        department: department || null
      };
    }

    const user = new User(userData);
    await user.save();

    console.log('User created successfully:', user._id);

    // Optionally create initial schedules for new doctors (disabled by default)
    // Enable by setting env AUTO_CREATE_DOCTOR_SCHEDULES=true
    if (role === 'doctor' && process.env.AUTO_CREATE_DOCTOR_SCHEDULES === 'true') {
      try {
        await createInitialDoctorSchedule(user._id);
        console.log('Initial schedule created for doctor:', user._id);
      } catch (scheduleError) {
        console.error('Error creating initial schedule:', scheduleError);
        // Don't fail the entire request if schedule creation fails
      }
    }

    // Send credentials email
    try {
      console.log('Attempting to send email to:', email);
      console.log('Email config - FROM:', process.env.EMAIL_USER);
      console.log('Temp password:', tempPassword);

      await sendAccountCredentialsEmail(email, tempPassword, role, name);
      console.log('✅ Email sent successfully to:', email);
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError.message);
      console.error('Full email error:', emailError);
      // Don't fail the entire request if email fails
    }

    const userResponse = await User.findById(user._id)
      .select('-password')
      .populate('doctor_info.department', 'name description');
    
    res.status(201).json({
      user: userResponse,
      tempPassword: tempPassword,
      message: `${role} account created successfully. Login credentials sent to ${email}`
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Server error: ' + error.message });
  }
});

// Helper function to create initial schedule for new doctors
const createInitialDoctorSchedule = async (doctorId) => {
  try {
    const schedules = [];
    const today = new Date();
    
    // Create schedules for the next 30 days (excluding weekends)
    for (let i = 1; i <= 30; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      date.setHours(0, 0, 0, 0);
      
      // Skip weekends (Saturday = 6, Sunday = 0)
      if (date.getDay() === 0 || date.getDay() === 6) {
        continue;
      }
      
      const schedule = new DoctorSchedule({
        doctor_id: doctorId,
        date: date,
        is_available: true,
        working_hours: {
          start_time: '09:00',
          end_time: '17:00'
        },
        break_time: {
          start_time: '13:00',
          end_time: '14:00'
        },
        slot_duration: 30,
        max_patients_per_slot: 20, // Default to 20 patients
        leave_reason: '',
        notes: 'Default schedule created by admin'
      });
      
      schedules.push(schedule);
    }
    
    // Bulk insert schedules
    if (schedules.length > 0) {
      await DoctorSchedule.insertMany(schedules);
    }
  } catch (error) {
    console.error('Error creating initial doctor schedule:', error);
    throw error;
  }
};

// Create user without email (Admin only) - Direct credential sharing
router.post('/users-direct', adminMiddleware, async (req, res) => {
  try {
    const { name, email, phone, role, department, specialization, experience_years } = req.body;

    // Validate role
    if (!['doctor', 'receptionist'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Only doctor and receptionist can be created.' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Generate temporary password
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    // Create user object with role-specific info
    const userData = {
      name,
      email,
      password: hashedPassword,
      phone: phone || '',
      role,
      isVerified: true
    };

    // Add role-specific nested fields
    if (role === 'doctor') {
      userData.doctor_info = {
        department: department || '',
        specialization: specialization || '',
        experience_years: experience_years || 0,
        calendar: [],
        status: 'active'
      };
    } else if (role === 'receptionist') {
      userData.receptionist_info = {
        department: department || ''
      };
    }

    const user = new User(userData);
    await user.save();

    // Send credentials email to doctor
    await sendAccountCredentialsEmail(email, tempPassword, role, name);

    // Return user data with temporary password for admin display
    const userResponse = await User.findById(user._id).select('-password');
    res.status(201).json({
      user: userResponse,
      tempPassword: tempPassword, // Return password for admin to see and share if needed
      message: `${role} account created successfully. Login credentials sent to ${email} and displayed below.`
    });

  } catch (error) {
    console.error('Create user direct error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== DEPARTMENT MANAGEMENT ====================

// Get all departments
router.get('/departments', adminMiddleware, async (req, res) => {
  try {
    const departments = await Department.find()
      .populate('head_of_department', 'name email')
      .populate('created_by', 'name email')
      .sort({ name: 1 });

    res.json({ departments });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new department
router.post('/departments', adminMiddleware, async (req, res) => {
  try {
    console.log('Department creation request received:', req.body);
    console.log('Admin user:', req.user);

    const { name, description, icon, services } = req.body;

    if (!name || !description) {
      return res.status(400).json({ message: 'Name and description are required' });
    }

    // Check if department already exists
    const existingDepartment = await Department.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') }
    });

    if (existingDepartment) {
      return res.status(400).json({ message: 'Department already exists' });
    }

    const department = new Department({
      name: name.trim(),
      description: description.trim(),
      icon: icon || 'hospital',
      services: services || [],
      created_by: req.user._id
    });

    console.log('Attempting to save department:', department);
    await department.save();
    console.log('Department saved successfully');

    const populatedDepartment = await Department.findById(department._id)
      .populate('created_by', 'name email');

    res.status(201).json({
      message: 'Department created successfully',
      department: populatedDepartment
    });
  } catch (error) {
    console.error('Create department error:', error);
    res.status(500).json({ message: 'Server error: ' + error.message });
  }
});

// Update department
router.put('/departments/:id', adminMiddleware, async (req, res) => {
  try {
    const { name, description, icon, services, isActive, head_of_department } = req.body;

    const department = await Department.findByIdAndUpdate(
      req.params.id,
      {
        name: name?.trim(),
        description: description?.trim(),
        icon,
        services,
        isActive,
        head_of_department: head_of_department || null
      },
      { new: true }
    ).populate('head_of_department', 'name email')
     .populate('created_by', 'name email');

    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }

    res.json({ message: 'Department updated successfully', department });
  } catch (error) {
    console.error('Update department error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete department
// Update department status (activate/deactivate)
router.patch('/departments/:id/status', adminMiddleware, async (req, res) => {
  try {
    const { isActive } = req.body;
    
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive must be a boolean value' });
    }

    const department = await Department.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    ).populate('head_of_department', 'name email')
     .populate('created_by', 'name email');

    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }

    res.json({ 
      message: `Department ${isActive ? 'activated' : 'deactivated'} successfully`,
      department 
    });
  } catch (error) {
    console.error('Update department status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/departments/:id', adminMiddleware, async (req, res) => {
  try {
    // Check if any doctors are assigned to this department
    const doctorsInDepartment = await User.countDocuments({
      role: 'doctor',
      'doctor_info.department': req.params.id
    });

    if (doctorsInDepartment > 0) {
      return res.status(400).json({
        message: 'Cannot delete department. Doctors are still assigned to this department.'
      });
    }

    const department = await Department.findByIdAndDelete(req.params.id);

    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }

    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Delete department error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== DOCTOR SCHEDULE MANAGEMENT =====

// Get doctor schedules
router.get('/doctor-schedules/:doctorId', adminMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { startDate, endDate } = req.query;

    // Verify doctor exists
    const doctor = await User.findById(doctorId).select('name role');
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const query = { doctor_id: doctorId };
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const schedules = await DoctorSchedule.find(query).sort({ date: 1 });

    res.json({
      doctor: doctor.name,
      schedules: schedules.map(schedule => ({
        id: schedule._id,
        date: schedule.date,
        isAvailable: schedule.is_available,
        workingHours: schedule.working_hours,
        breakTime: schedule.break_time,
        slotDuration: schedule.slot_duration,
        maxPatientsPerSlot: schedule.max_patients_per_slot,
        bookedSlots: schedule.booked_slots,
        leaveReason: schedule.leave_reason,
        notes: schedule.notes,
        morningSession: schedule.morning_session,
        afternoonSession: schedule.afternoon_session
      }))
    });
  } catch (error) {
    console.error('Get doctor schedules error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create/Update doctor schedule
router.post('/doctor-schedules/:doctorId', adminMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const {
      date,
      isAvailable,
      workingHours,
      breakTime,
      slotDuration,
      maxPatientsPerSlot,
      leaveReason,
      notes,
      morningSession,
      afternoonSession
    } = req.body;

    // Verify doctor exists
    const doctor = await User.findById(doctorId).select('name role');
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const scheduleDate = new Date(date);
    scheduleDate.setHours(0, 0, 0, 0);

    // Check if schedule already exists for this date
    let schedule = await DoctorSchedule.findOne({
      doctor_id: doctorId,
      date: scheduleDate
    });

    // Helper to normalize session payload keys (maxPatients -> max_patients)
    const normalizeSession = (session, fallback) => {
      const base = fallback || {};
      if (!session && fallback) return base;
      return {
        available: session?.available ?? base.available ?? true,
        start_time: session?.start_time ?? base.start_time ?? '09:00',
        end_time: session?.end_time ?? base.end_time ?? '13:00',
        max_patients: (session?.maxPatients ?? session?.max_patients ?? base.max_patients ?? 10)
      };
    };

    if (schedule) {
      // Update existing schedule
      schedule.is_available = isAvailable !== undefined ? isAvailable : schedule.is_available;
      schedule.working_hours = workingHours || schedule.working_hours;
      schedule.break_time = breakTime || schedule.break_time;
      schedule.slot_duration = slotDuration || schedule.slot_duration;
      schedule.max_patients_per_slot = maxPatientsPerSlot || schedule.max_patients_per_slot;
      schedule.leave_reason = leaveReason || schedule.leave_reason;
      schedule.notes = notes || schedule.notes;
      // Update session data
      schedule.morning_session = normalizeSession(morningSession, schedule.morning_session);
      schedule.afternoon_session = normalizeSession(afternoonSession, schedule.afternoon_session);
      
      await schedule.save();
    } else {
      // Create new schedule
      schedule = new DoctorSchedule({
        doctor_id: doctorId,
        date: scheduleDate,
        is_available: isAvailable !== undefined ? isAvailable : true,
        working_hours: workingHours || {
          start_time: '09:00',
          end_time: '17:00'
        },
        break_time: breakTime || {
          start_time: '13:00',
          end_time: '14:00'
        },
        slot_duration: slotDuration || 30,
        max_patients_per_slot: maxPatientsPerSlot || 20, // Default to 20 patients
        leave_reason: leaveReason || '',
        notes: notes || '',
        // Session-based scheduling
        morning_session: normalizeSession(morningSession, {
          available: true,
          start_time: '09:00',
          end_time: '13:00',
          max_patients: 10
        }),
        afternoon_session: normalizeSession(afternoonSession, {
          available: true,
          start_time: '14:00',
          end_time: '18:00',
          max_patients: 10
        })
      });
      
      await schedule.save();
    }

    res.json({
      message: 'Doctor schedule updated successfully',
      schedule: {
        id: schedule._id,
        date: schedule.date,
        isAvailable: schedule.is_available,
        workingHours: schedule.working_hours,
        breakTime: schedule.break_time,
        slotDuration: schedule.slot_duration,
        maxPatientsPerSlot: schedule.max_patients_per_slot,
        leaveReason: schedule.leave_reason,
        notes: schedule.notes,
        morningSession: schedule.morning_session,
        afternoonSession: schedule.afternoon_session
      }
    });
  } catch (error) {
    console.error('Create/Update doctor schedule error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete doctor schedule
router.delete('/doctor-schedules/:scheduleId', adminMiddleware, async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const schedule = await DoctorSchedule.findByIdAndDelete(scheduleId);

    if (!schedule) {
      return res.status(404).json({ message: 'Schedule not found' });
    }

    res.json({ message: 'Doctor schedule deleted successfully' });
  } catch (error) {
    console.error('Delete doctor schedule error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Bulk delete schedules for a doctor
router.post('/doctor-schedules/:doctorId/bulk-delete', adminMiddleware, async (req, res) => {
  try {
    console.log('Bulk delete endpoint hit:', {
      doctorId: req.params.doctorId,
      body: req.body,
      method: req.method,
      url: req.url
    });
    
    const { doctorId } = req.params;
    const { deleteType, startDate, endDate, scheduleIds } = req.body;

    // Verify doctor exists
    const doctor = await User.findById(doctorId).select('name role');
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    let deletedCount = 0;

    if (deleteType === 'range') {
      // Delete schedules by date range
      const start = new Date(startDate);
      const end = new Date(endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      const result = await DoctorSchedule.deleteMany({
        doctor_id: doctorId,
        date: { $gte: start, $lte: end }
      });

      deletedCount = result.deletedCount;
    } else if (deleteType === 'selected') {
      // Delete selected schedules by IDs
      if (!scheduleIds || scheduleIds.length === 0) {
        return res.status(400).json({ message: 'No schedules selected for deletion' });
      }

      // Convert string IDs to ObjectIds
      const objectIds = scheduleIds.map(id => {
        try {
          return new mongoose.Types.ObjectId(id);
        } catch (error) {
          console.error('Invalid ObjectId:', id);
          return null;
        }
      }).filter(id => id !== null);

      if (objectIds.length === 0) {
        return res.status(400).json({ message: 'No valid schedule IDs provided' });
      }

      const result = await DoctorSchedule.deleteMany({
        doctor_id: doctorId,
        _id: { $in: objectIds }
      });

      deletedCount = result.deletedCount;
    } else {
      return res.status(400).json({ message: 'Invalid delete type' });
    }

    res.json({
      message: `Successfully deleted ${deletedCount} schedules for Dr. ${doctor.name}`,
      deletedCount
    });
  } catch (error) {
    console.error('Bulk delete doctor schedules error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== DOCTOR LEAVE REQUESTS =====

// List leave requests (optional filtering by status)
router.get('/leave-requests', adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status) query.status = status;
    
    const leaves = await LeaveRequest.find(query)
      .populate({
        path: 'doctor_id',
        select: 'name email phone',
        populate: {
          path: 'doctor_info.department',
          select: 'name'
        }
      })
      .sort({ start_date: -1, createdAt: -1 });
    
    res.json({ leaves });
  } catch (error) {
    console.error('List leave requests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Approve a leave request and disable bookings for that date
router.post('/leave-requests/:id/approve', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_comment } = req.body;
    
    console.log('Approving leave request:', id, 'with comment:', admin_comment);
    
    const leave = await LeaveRequest.findById(id).populate('doctor_id');
    if (!leave) {
      console.log('Leave request not found:', id);
      return res.status(404).json({ message: 'Leave request not found' });
    }

    console.log('Found leave request:', leave);

    // Update leave request status
    leave.status = 'approved';
    if (admin_comment) leave.admin_comment = admin_comment;
    await leave.save();
    console.log('Leave request updated successfully');

    // Handle schedule updates for the date range
    const startDate = new Date(leave.start_date);
    const endDate = new Date(leave.end_date);
    
    // Process each day in the leave period
    let cancelledAppointmentsCount = 0;
    for (let currentDate = new Date(startDate); currentDate <= endDate; currentDate.setDate(currentDate.getDate() + 1)) {
      const scheduleDate = new Date(currentDate);
      scheduleDate.setHours(0, 0, 0, 0);
      
      console.log('Processing schedule for date:', scheduleDate);

      let schedule = await DoctorSchedule.findOne({ 
        doctor_id: leave.doctor_id, 
        date: scheduleDate 
      });
      
      if (!schedule) {
        console.log('Creating new schedule for leave date');
        schedule = new DoctorSchedule({
          doctor_id: leave.doctor_id,
          date: scheduleDate,
          is_available: false,
          leave_reason: leave.reason || 'Approved leave',
          notes: 'Auto-set by admin leave approval'
        });
      } else {
        console.log('Updating existing schedule');
        schedule.is_available = false;
        schedule.leave_reason = leave.reason || 'Approved leave';
      }

      // Handle half-day leave
      if (leave.leave_type === 'half_day') {
        schedule.is_available = true; // Doctor is available for the other session
        
        if (leave.session === 'morning') {
          // Block morning session, keep afternoon available
          schedule.morning_session = {
            available: false,
            start_time: '09:00',
            end_time: '13:00',
            max_patients: 0
          };
          schedule.afternoon_session = {
            available: true,
            start_time: '14:00',
            end_time: '18:00',
            max_patients: 10
          };
        } else {
          // Block afternoon session, keep morning available
          schedule.morning_session = {
            available: true,
            start_time: '09:00',
            end_time: '13:00',
            max_patients: 10
          };
          schedule.afternoon_session = {
            available: false,
            start_time: '14:00',
            end_time: '18:00',
            max_patients: 0
          };
        }
      } else {
        // Full day leave - block all sessions
        schedule.morning_session = {
          available: false,
          start_time: '09:00',
          end_time: '13:00',
          max_patients: 0
        };
        schedule.afternoon_session = {
          available: false,
          start_time: '14:00',
          end_time: '18:00',
          max_patients: 0
        };
      }
      
      await schedule.save();
      console.log('Schedule saved successfully for date:', scheduleDate);

      // Cancel existing appointments for this date
      const appointmentDate = new Date(scheduleDate);
      appointmentDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(appointmentDate);
      nextDay.setDate(nextDay.getDate() + 1);

      // Find and cancel appointments (booked / in_queue / confirmed)
      const appointments = await Token.find({
        doctor_id: leave.doctor_id,
        booking_date: { $gte: appointmentDate, $lt: nextDay },
        status: { $in: ['booked', 'in_queue', 'confirmed'] }
      }).populate('patient_id', 'name email');

      console.log(`Found ${appointments.length} appointments to cancel`);

      for (const appointment of appointments) {
        // Check if it's a half-day leave and appointment is in available session
        if (leave.leave_type === 'half_day') {
          const timeStr = appointment.time_slot || '09:00';
          const appointmentHour = parseInt(String(timeStr).split(':')[0] || '9', 10);
          
          if (leave.session === 'morning' && appointmentHour >= 14) {
            // Morning leave, afternoon appointment - keep it
            continue;
          } else if (leave.session === 'afternoon' && appointmentHour < 14) {
            // Afternoon leave, morning appointment - keep it
            continue;
          }
        }
        
        // Cancel the appointment
        appointment.status = 'cancelled_by_hospital';
        appointment.cancellation_reason = `Doctor on leave: ${leave.reason || 'No reason provided'}`;
        appointment.cancelled_at = new Date();
        appointment.cancelled_by = 'system';

        // Auto-refund for paid appointments
        if (appointment.payment_status === 'paid') {
          appointment.payment_status = 'refunded';
          appointment.refund_reason = 'Auto-refund: Doctor on leave';
          appointment.refunded_at = new Date();
          appointment.refund_amount = appointment.fee || 500;
          appointment.refund_method = appointment.paymentMethod || 'original';
          try {
            const notificationService = require('../services/notificationService');
            await notificationService.sendRefundNotification({
              patientName: appointment.patient_id?.name || 'Patient',
              patientEmail: appointment.patient_id?.email,
              amount: appointment.refund_amount,
              reason: appointment.refund_reason,
              appointmentDate: appointment.booking_date,
              doctorName: appointment.doctor_id?.name || 'Doctor'
            });
          } catch (e) {
            console.error('Failed to send auto-refund notification:', e);
          }
        }

        await appointment.save();
        cancelledAppointmentsCount += 1;
        
        // Send notification to patient
        try {
          const notificationService = require('../services/notificationService');
          await notificationService.sendLeaveCancellationNotification(appointment._id, {
            leave_type: leave.leave_type,
            session: leave.session,
            reason: leave.reason
          });
          // Best-effort email
          try {
            const { transporter } = require('../config/email');
            if (appointment.patient_id?.email) {
              await transporter.sendMail({
                to: appointment.patient_id.email,
                subject: 'Appointment Cancelled - Doctor on Leave',
                html: `<p>Dear ${appointment.patient_id.name || 'Patient'},</p>
                       <p>Your appointment on ${appointment.booking_date.toLocaleDateString()} at ${appointment.time_slot || ''} was cancelled because the doctor is on leave.</p>
                       <p>Please reschedule from the portal. We apologize for the inconvenience.</p>`
              });
            }
          } catch (mailErr) {
            console.warn('Email send failed:', mailErr?.message || mailErr);
          }
          console.log(`📧📱💬 Leave cancellation notification sent for appointment: ${appointment._id}`);
        } catch (notificationError) {
          console.error('Failed to send leave cancellation notification:', notificationError);
        }
      }
    }

    // Create notification for doctor about leave approval
    try {
      const notificationService = require('../services/notificationService');
      await notificationService.createLeaveApprovalNotification(leave);
      console.log('🔔 Leave approval notification created for doctor');
    } catch (notificationError) {
      console.error('Failed to create leave approval notification:', notificationError);
    }

    // Realtime sync summary to all roles
    try {
      const io = req.app.get('io');
      if (io) {
        io.to('admin').emit('appointments-cancelled', { doctorId: leave.doctor_id, date: scheduleDate, count: cancelledAppointmentsCount });
        io.to('patient').emit('appointments-cancelled', { doctorId: leave.doctor_id, date: scheduleDate, count: cancelledAppointmentsCount });
        io.to('doctor').emit('appointments-cancelled', { doctorId: leave.doctor_id, date: scheduleDate, count: cancelledAppointmentsCount });
      }
    } catch (e) {
      console.error('Realtime emit error (leave approve):', e);
    }

    res.json({ 
      message: 'Leave request approved successfully',
      leave: leave,
      cancelledAppointments: cancelledAppointmentsCount
    });
  } catch (error) {
    console.error('Approve leave request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reject a leave request
router.post('/leave-requests/:id/reject', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_comment } = req.body;
    
    const leave = await LeaveRequest.findById(id);
    if (!leave) {
      return res.status(404).json({ message: 'Leave request not found' });
    }

    // Update leave request status
    leave.status = 'rejected';
    if (admin_comment) leave.admin_comment = admin_comment;
    await leave.save();

    // Create notification for doctor about leave rejection
    try {
      const notificationService = require('../services/notificationService');
      await notificationService.createLeaveRejectionNotification(leave);
      console.log('🔔 Leave rejection notification created for doctor');
    } catch (notificationError) {
      console.error('Failed to create leave rejection notification:', notificationError);
    }

    res.json({ 
      message: 'Leave request rejected successfully',
      leave: leave
    });
  } catch (error) {
    console.error('Reject leave request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Messaging: Admin send message/notification to a patient by appointment
router.post('/messages/patient', adminMiddleware, async (req, res) => {
  try {
    const { appointmentId, subject, message } = req.body;
    if (!appointmentId || !message) return res.status(400).json({ message: 'appointmentId and message are required' });

    const { Token } = require('../models/User');
    const appointment = await Token.findById(appointmentId).populate('patient_id', 'email phone name');
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    // Email (best-effort)
    try {
      const { transporter } = require('../config/email');
      if (appointment.patient_id?.email) {
        await transporter.sendMail({
          to: appointment.patient_id.email,
          subject: subject || 'Message from Hospital Administration',
          html: `<p>Dear ${appointment.patient_id.name || 'Patient'},</p><p>${message}</p>`
        });
      }
    } catch (e) {
      console.warn('Admin -> patient email failed:', e?.message || e);
    }

    // Optional: enqueue SMS via smsService if configured
    try {
      const smsService = require('../services/smsService');
      if (appointment.patient_id?.phone) {
        await smsService.sendGeneric(appointment.patient_id.phone, message);
      }
    } catch (e) {
      console.warn('Admin -> patient SMS failed:', e?.message || e);
    }

    res.json({ message: 'Message sent to patient (best-effort)' });
  } catch (error) {
    console.error('Admin message patient error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Feedback/Complaints: Patient to Admin
router.post('/feedback', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let authPatientId = null;
    try {
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
        authPatientId = decoded?.userId || null;
      }
    } catch {}

    const {
      patient_id: bodyPatientId,
      doctor_id,
      appointment_id,
      type = 'feedback',
      subject = '',
      message,
      guest_name = '',
      guest_email = '',
      guest_phone = ''
    } = req.body;

    if (!message) return res.status(400).json({ message: 'message is required' });

    // Determine patient_id (auth wins), else accept guest
    const patient_id = authPatientId || bodyPatientId || null;

    if (!patient_id && !guest_email) {
      return res.status(400).json({ message: 'guest_email is required for guest submission' });
    }

    const payload = {
      patient_id,
      doctor_id,
      appointment_id,
      type,
      subject,
      message,
      guest_name,
      guest_email,
      guest_phone
    };

    const feedback = await Feedback.create(payload);

    // Hydrate minimal patient view in response
    let patient = null;
    if (patient_id) {
      const { User } = require('../models/User');
      patient = await User.findById(patient_id).select('name email phone patientId');
    }

    res.json({
      message: 'Submitted',
      feedback: {
        _id: feedback._id,
        type: feedback.type,
        subject: feedback.subject,
        message: feedback.message,
        status: feedback.status,
        createdAt: feedback.createdAt,
        patient: patient ? {
          id: patient._id,
          name: patient.name,
          email: patient.email,
          phone: patient.phone,
          patientId: patient.patientId
        } : null,
        guest: !patient ? {
          name: feedback.guest_name,
          email: feedback.guest_email,
          phone: feedback.guest_phone
        } : null
      }
    });
  } catch (error) {
    console.error('Create feedback error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/feedback', adminMiddleware, async (req, res) => {
  try {
    const { status, patientId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (patientId) {
      const user = await User.findOne({ patientId }).select('_id');
      if (user) query.patient_id = user._id;
    }
    const items = await Feedback.find(query).populate('patient_id', 'name email phone').populate('doctor_id', 'name').sort({ createdAt: -1 });
    res.json({ items });
  } catch (error) {
    console.error('List feedback error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/feedback/:id', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;
    const item = await Feedback.findByIdAndUpdate(id, { $set: { ...(status && { status }), ...(admin_notes !== undefined ? { admin_notes } : {}) } }, { new: true });
    if (!item) return res.status(404).json({ message: 'Feedback not found' });
    res.json({ message: 'Updated', item });
  } catch (error) {
    console.error('Update feedback error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Bulk create schedules for a doctor (for setting up weekly/monthly schedules)
router.post('/doctor-schedules/:doctorId/bulk', adminMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { startDate, endDate, scheduleTemplate, skipWeekends = true } = req.body;

    // Verify doctor exists
    const doctor = await User.findById(doctorId).select('name role');
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const schedules = [];

    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      // Skip weekends if requested
      if (skipWeekends && (date.getDay() === 0 || date.getDay() === 6)) {
        continue;
      }

      const scheduleDate = new Date(date);
      scheduleDate.setHours(0, 0, 0, 0);

      // Check if schedule already exists
      const existingSchedule = await DoctorSchedule.findOne({
        doctor_id: doctorId,
        date: scheduleDate
      });

      if (!existingSchedule) {
        const schedule = new DoctorSchedule({
          doctor_id: doctorId,
          date: scheduleDate,
          is_available: scheduleTemplate.isAvailable !== undefined ? scheduleTemplate.isAvailable : true,
          working_hours: scheduleTemplate.workingHours || {
            start_time: '09:00',
            end_time: '17:00'
          },
          break_time: scheduleTemplate.breakTime || {
            start_time: '13:00',
            end_time: '14:00'
          },
          slot_duration: scheduleTemplate.slotDuration || 30,
          max_patients_per_slot: scheduleTemplate.maxPatientsPerSlot || 20, // Default to 20 patients
          // Session-based scheduling
          morning_session: scheduleTemplate.morningSession || {
            available: true,
            start_time: '09:00',
            end_time: '13:00',
            max_patients: 10
          },
          afternoon_session: scheduleTemplate.afternoonSession || {
            available: true,
            start_time: '14:00',
            end_time: '18:00',
            max_patients: 10
          }
        });

        schedules.push(schedule);
      }
    }

    if (schedules.length > 0) {
      try {
        await DoctorSchedule.insertMany(schedules, { ordered: false });
      } catch (error) {
        // Handle duplicate key errors gracefully
        if (error.code === 11000) {
          console.log('Some schedules already exist, continuing...');
        } else {
          throw error;
        }
      }
    }

    res.json({
      message: `Successfully created ${schedules.length} schedules for Dr. ${doctor.name}`,
      createdCount: schedules.length
    });
  } catch (error) {
    console.error('Bulk create doctor schedules error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Family Member Management Routes

// Get all family members with parent patient details
router.get('/family-members', adminMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const pageSize = Math.max(1, Math.min(200, parseInt(limit)));

    // Build query with optional name/email/phone search
    const FamilyMember = mongoose.model('FamilyMember');
    const UserModel = mongoose.model('User');

    const fmQuery = {};
    if (search && String(search).trim().length > 0) {
      const regex = new RegExp(String(search).trim(), 'i');
      fmQuery.$or = [
        { name: regex },
        { patientId: regex },
        { relation: regex }
      ];
    }

    const total = await FamilyMember.countDocuments(fmQuery);

    const familyMembers = await FamilyMember.find(fmQuery)
      .populate('patient_id', 'name email phone patientId')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize);

    const membersWithParent = familyMembers.map(member => ({
      _id: member._id,
      patientId: member.patientId,
      name: member.name,
      age: member.age,
      gender: member.gender,
      relation: member.relation,
      phone: member.phone,
      bloodGroup: member.bloodGroup,
      allergies: member.allergies,
      chronicConditions: member.chronicConditions,
      emergency_contact: member.emergency_contact,
      isActive: member.isActive,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      parentPatient: member.patient_id ? {
        _id: member.patient_id._id,
        name: member.patient_id.name,
        email: member.patient_id.email,
        phone: member.patient_id.phone,
        patientId: member.patient_id.patientId
      } : null
    }));

    res.json({ 
      familyMembers: membersWithParent,
      total,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error('Get family members error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new family member
router.post('/family-members', adminMiddleware, async (req, res) => {
  try {
    const { patient_id, name, age, gender, relation, phone, bloodGroup, allergies, chronicConditions, emergency_contact } = req.body;

    if (!patient_id || !name || !age || !gender || !relation) {
      return res.status(400).json({ message: 'Required fields: patient_id, name, age, gender, relation' });
    }

    // Verify parent patient exists
    const parentPatient = await User.findById(patient_id);
    if (!parentPatient || parentPatient.role !== 'patient') {
      return res.status(404).json({ message: 'Parent patient not found' });
    }

    const familyMember = await mongoose.model('FamilyMember').create({
      patient_id,
      name,
      age: parseInt(age),
      gender,
      relation,
      phone: phone || '',
      bloodGroup: bloodGroup || '',
      allergies: allergies || '',
      chronicConditions: chronicConditions || '',
      emergency_contact: emergency_contact || {}
    });

    await familyMember.populate('patient_id', 'name email phone patientId');

    res.json({
      message: 'Family member created successfully',
      familyMember: {
        _id: familyMember._id,
        patientId: familyMember.patientId,
        name: familyMember.name,
        age: familyMember.age,
        gender: familyMember.gender,
        relation: familyMember.relation,
        phone: familyMember.phone,
        bloodGroup: familyMember.bloodGroup,
        allergies: familyMember.allergies,
        chronicConditions: familyMember.chronicConditions,
        emergency_contact: familyMember.emergency_contact,
        isActive: familyMember.isActive,
        createdAt: familyMember.createdAt,
        updatedAt: familyMember.updatedAt,
        parentPatient: {
          _id: familyMember.patient_id._id,
          name: familyMember.patient_id.name,
          email: familyMember.patient_id.email,
          phone: familyMember.patient_id.phone,
          patientId: familyMember.patient_id.patientId
        }
      }
    });
  } catch (error) {
    console.error('Create family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update family member
router.put('/family-members/:id', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, age, gender, relation, phone, bloodGroup, allergies, chronicConditions, emergency_contact } = req.body;

    const familyMember = await mongoose.model('FamilyMember').findByIdAndUpdate(
      id,
      {
        $set: {
          ...(name && { name }),
          ...(age && { age: parseInt(age) }),
          ...(gender && { gender }),
          ...(relation && { relation }),
          ...(phone !== undefined && { phone }),
          ...(bloodGroup !== undefined && { bloodGroup }),
          ...(allergies !== undefined && { allergies }),
          ...(chronicConditions !== undefined && { chronicConditions }),
          ...(emergency_contact && { emergency_contact })
        }
      },
      { new: true }
    ).populate('patient_id', 'name email phone patientId');

    if (!familyMember) {
      return res.status(404).json({ message: 'Family member not found' });
    }

    res.json({
      message: 'Family member updated successfully',
      familyMember: {
        _id: familyMember._id,
        patientId: familyMember.patientId,
        name: familyMember.name,
        age: familyMember.age,
        gender: familyMember.gender,
        relation: familyMember.relation,
        phone: familyMember.phone,
        bloodGroup: familyMember.bloodGroup,
        allergies: familyMember.allergies,
        chronicConditions: familyMember.chronicConditions,
        emergency_contact: familyMember.emergency_contact,
        isActive: familyMember.isActive,
        createdAt: familyMember.createdAt,
        updatedAt: familyMember.updatedAt,
        parentPatient: {
          _id: familyMember.patient_id._id,
          name: familyMember.patient_id.name,
          email: familyMember.patient_id.email,
          phone: familyMember.patient_id.phone,
          patientId: familyMember.patient_id.patientId
        }
      }
    });
  } catch (error) {
    console.error('Update family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Toggle family member active status
router.put('/family-members/:id/status', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const familyMember = await mongoose.model('FamilyMember').findByIdAndUpdate(
      id,
      { $set: { isActive } },
      { new: true }
    ).populate('patient_id', 'name email phone patientId');

    if (!familyMember) {
      return res.status(404).json({ message: 'Family member not found' });
    }

    res.json({
      message: `Family member ${isActive ? 'activated' : 'deactivated'} successfully`,
      familyMember: {
        _id: familyMember._id,
        patientId: familyMember.patientId,
        name: familyMember.name,
        age: familyMember.age,
        gender: familyMember.gender,
        relation: familyMember.relation,
        phone: familyMember.phone,
        bloodGroup: familyMember.bloodGroup,
        allergies: familyMember.allergies,
        chronicConditions: familyMember.chronicConditions,
        emergency_contact: familyMember.emergency_contact,
        isActive: familyMember.isActive,
        createdAt: familyMember.createdAt,
        updatedAt: familyMember.updatedAt,
        parentPatient: {
          _id: familyMember.patient_id._id,
          name: familyMember.patient_id.name,
          email: familyMember.patient_id.email,
          phone: familyMember.patient_id.phone,
          patientId: familyMember.patient_id.patientId
        }
      }
    });
  } catch (error) {
    console.error('Toggle family member status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete family member
router.delete('/family-members/:id', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const familyMember = await mongoose.model('FamilyMember').findByIdAndDelete(id);
    if (!familyMember) {
      return res.status(404).json({ message: 'Family member not found' });
    }

    res.json({ message: 'Family member deleted successfully' });
  } catch (error) {
    console.error('Delete family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Payment Management Routes

// Get all payments with filtering and pagination
router.get('/payments', adminMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      method = '',
      date = '',
      patientId = ''
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const pageSize = Math.max(1, Math.min(200, parseInt(limit)));

    const query = {};
    if (status) query.payment_status = status;
    if (method) query.paymentMethod = method;
    if (patientId) {
      // match either main account or family member code
      const users = await User.find({ patientId }).select('_id');
      const FamilyMember = mongoose.model('FamilyMember');
      const fam = await FamilyMember.findOne({ patientId }).select('_id');
      if (users.length) query.patient_id = users[0]._id;
      if (fam) query.family_member_id = fam._id;
    }
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      // Filter by payment date if available, otherwise by appointment/creation date
      query.$or = [
        { paid_at: { $gte: startDate, $lte: endDate } },
        { booking_date: { $gte: startDate, $lte: endDate } },
        { createdAt: { $gte: startDate, $lte: endDate } }
      ];
    }

    const total = await Token.countDocuments(query);
    const appointments = await Token.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .populate('patient_id', 'name email phone patientId')
      .populate('family_member_id', 'name relation patientId')
      .populate({
        path: 'doctor_id',
        select: 'name doctor_info',
        populate: { path: 'doctor_info.department', select: 'name' }
      });

    const payments = appointments.map(apt => ({
      _id: apt._id,
      transactionId: apt._id.toString().slice(-8).toUpperCase(),
      appointmentId: apt._id,
      patientId: apt.family_member_id?.patientId || apt.patient_id?.patientId || null,
      patientName: apt.family_member_id?.name || apt.patient_id?.name || 'Unknown',
      patientEmail: apt.patient_id?.email || '',
      patientPhone: apt.patient_id?.phone || '',
      doctorName: apt.doctor_id?.name || 'Unknown',
      department: apt.department || apt.doctor_id?.doctor_info?.department?.name || 'Unknown',
      appointmentDate: apt.booking_date,
      amount: apt.fee || 500, // Default fee if not set
      method: apt.paymentMethod || 'cash',
      status: apt.payment_status || 'pending',
      refundReason: apt.refund_reason || '',
      paidAt: apt.paid_at || null,
      refundedAt: apt.refunded_at || null,
      createdAt: apt.createdAt,
      updatedAt: apt.updatedAt
    }));

    res.json({ 
      payments, 
      total, 
      page: pageNum, 
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Process refund for a payment
router.post('/payments/:id/refund', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, amount, method } = req.body;

    if (!reason) {
      return res.status(400).json({ message: 'Refund reason is required' });
    }

    const appointment = await Token.findById(id);
    if (!appointment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    if (appointment.payment_status !== 'paid') {
      return res.status(400).json({ message: 'Only paid payments can be refunded' });
    }

    // Update appointment with refund information
    appointment.payment_status = 'refunded';
    appointment.refund_reason = reason;
    appointment.refunded_at = new Date();
    appointment.refund_amount = amount || appointment.fee || 500;
    appointment.refund_method = method || 'original';
    await appointment.save();

    // Send refund notification email to patient
    try {
      const notificationService = require('../services/notificationService');
      await notificationService.sendRefundNotification({
        patientName: appointment.patient_id?.name || 'Patient',
        patientEmail: appointment.patient_id?.email,
        amount: appointment.refund_amount,
        reason: reason,
        appointmentDate: appointment.booking_date,
        doctorName: appointment.doctor_id?.name || 'Doctor'
      });
    } catch (notificationError) {
      console.error('Failed to send refund notification:', notificationError);
    }

    res.json({
      message: 'Refund processed successfully',
      refund: {
        id: appointment._id,
        amount: appointment.refund_amount,
        reason: appointment.refund_reason,
        method: appointment.refund_method,
        refundedAt: appointment.refunded_at
      }
    });
  } catch (error) {
    console.error('Process refund error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get payment statistics
router.get('/payments/stats', adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query = {};
    if (startDate && endDate) {
      query.createdAt = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    }

    const stats = await Token.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$payment_status',
          count: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ['$fee', 500] } }
        }
      }
    ]);

    const result = {
      totalTransactions: 0,
      totalRevenue: 0,
      totalRefunded: 0,
      pendingAmount: 0,
      paidCount: 0,
      refundedCount: 0,
      pendingCount: 0
    };

    stats.forEach(stat => {
      result.totalTransactions += stat.count;
      if (stat._id === 'paid') {
        result.totalRevenue += stat.totalAmount;
        result.paidCount = stat.count;
      } else if (stat._id === 'refunded') {
        result.totalRefunded += stat.totalAmount;
        result.refundedCount = stat.count;
      } else if (stat._id === 'pending') {
        result.pendingAmount += stat.totalAmount;
        result.pendingCount = stat.count;
      }
    });

    result.netRevenue = result.totalRevenue - result.totalRefunded;

    res.json(result);
  } catch (error) {
    console.error('Get payment stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Communication Management Routes

// Get all messages sent by admin
router.get('/messages', adminMiddleware, async (req, res) => {
  try {
    const messages = await mongoose.model('Message').find({})
      .populate('recipient_id', 'name email phone')
      .sort({ createdAt: -1 });

    const messagesWithRecipient = messages.map(msg => ({
      _id: msg._id,
      subject: msg.subject,
      message: msg.message,
      type: msg.type,
      priority: msg.priority,
      status: msg.status,
      recipientType: msg.recipient_type,
      recipientId: msg.recipient_id?._id,
      recipientName: msg.recipient_id?.name || msg.recipient_name,
      recipientEmail: msg.recipient_id?.email || msg.recipient_email,
      recipientPhone: msg.recipient_id?.phone || msg.recipient_phone,
      sentAt: msg.sent_at,
      deliveredAt: msg.delivered_at,
      readAt: msg.read_at,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt
    }));

    res.json({ messages: messagesWithRecipient });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send message to patients/doctors
router.post('/messages', adminMiddleware, async (req, res) => {
  try {
    const { recipientType, recipientId, subject, message, priority, type } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ message: 'Subject and message are required' });
    }

    const messages = [];
    let recipients = [];

    // Determine recipients based on type
    if (recipientType === 'all_patients') {
      recipients = await User.find({ role: 'patient' }).select('name email phone');
    } else if (recipientType === 'all_doctors') {
      recipients = await User.find({ role: 'doctor' }).select('name email phone');
    } else if (recipientType === 'patient' || recipientType === 'doctor') {
      if (!recipientId) {
        return res.status(400).json({ message: 'Recipient ID is required for single recipient' });
      }
      const recipient = await User.findById(recipientId);
      if (!recipient) {
        return res.status(404).json({ message: 'Recipient not found' });
      }
      recipients = [recipient];
    } else {
      return res.status(400).json({ message: 'Invalid recipient type' });
    }

    // Create messages for each recipient
    for (const recipient of recipients) {
      const messageDoc = await mongoose.model('Message').create({
        recipient_type: recipientType,
        recipient_id: recipient._id,
        recipient_name: recipient.name,
        recipient_email: recipient.email,
        recipient_phone: recipient.phone,
        subject: subject,
        message: message,
        type: type || 'notification',
        priority: priority || 'normal',
        status: 'sent',
        sent_at: new Date(),
        sent_by: req.user.userId
      });
      messages.push(messageDoc);

      // Send email notification
      try {
        const notificationService = require('../services/notificationService');
        await notificationService.sendAdminMessage({
          recipientName: recipient.name,
          recipientEmail: recipient.email,
          subject: subject,
          message: message,
          type: type || 'notification',
          priority: priority || 'normal'
        });
      } catch (notificationError) {
        console.error('Failed to send message notification:', notificationError);
      }
    }

    res.json({
      message: `Message sent to ${recipients.length} recipient(s)`,
      sentCount: recipients.length,
      messages: messages.map(msg => ({
        _id: msg._id,
        recipientName: msg.recipient_name,
        recipientEmail: msg.recipient_email,
        subject: msg.subject,
        status: msg.status
      }))
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get message statistics
router.get('/messages/stats', adminMiddleware, async (req, res) => {
  try {
    const stats = await mongoose.model('Message').aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const result = {
      total: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0
    };

    stats.forEach(stat => {
      result.total += stat.count;
      result[stat._id] = stat.count;
    });

    res.json(result);
  } catch (error) {
    console.error('Get message stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all schedule requests
router.get('/schedule-requests', adminMiddleware, async (req, res) => {
  try {
    // Get doctor names for each request
    const scheduleRequests = global.scheduleRequests || [];
    const requestsWithDoctorNames = await Promise.all(
      scheduleRequests.map(async (request) => {
        const doctor = await User.findById(request.doctorId);
        return {
          ...request,
          doctorName: doctor ? doctor.name : 'Unknown Doctor',
          doctorEmail: doctor ? doctor.email : 'Unknown Email'
        };
      })
    );

    res.json({
      success: true,
      requests: requestsWithDoctorNames
    });
  } catch (error) {
    console.error('Error fetching schedule requests:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch schedule requests' });
  }
});

// Approve schedule request
router.post('/schedule-requests/:requestId/approve', adminMiddleware, async (req, res) => {
  try {
    const { requestId } = req.params;
    const scheduleRequests = global.scheduleRequests || [];
    const request = scheduleRequests.find(r => r.id === requestId);
    
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    console.log('📝 Approving schedule request:', request.type, 'for doctor:', request.doctorId);
    console.log('📝 Request data:', JSON.stringify(request, null, 2));

    if (request.type === 'cancel') {
      // Delete the schedule
      const deletedSchedule = await DoctorSchedule.findByIdAndDelete(request.scheduleId);
      console.log('✅ Deleted schedule:', deletedSchedule?._id);
    } else if (request.type === 'reschedule') {
      try {
        // For reschedule, we need to update the original schedule (the one being rescheduled)
        // The newSchedule.date contains the date the doctor wants to reschedule TO
        // The request.date contains the original date being rescheduled
        
        console.log('🔄 Processing reschedule request...');
        
        // First, get the original schedule to understand what we're rescheduling
        const originalSchedule = await DoctorSchedule.findById(request.scheduleId);
        if (!originalSchedule) {
          console.log('❌ Original schedule not found:', request.scheduleId);
          return res.status(404).json({ success: false, message: 'Original schedule not found' });
        }
      
      console.log('📅 Original schedule date:', originalSchedule.date);
      console.log('📅 Request original date:', request.date);
      console.log('📅 New schedule date requested:', request.newSchedule.date);
      
      // Cancel/remove the original schedule (the date being rescheduled FROM)
      const originalDate = new Date(request.date || originalSchedule.date);
      originalDate.setHours(0, 0, 0, 0);
      
      // Delete the original schedule since it's being rescheduled
      const deletedSchedule = await DoctorSchedule.findByIdAndDelete(request.scheduleId);
      console.log('✅ Deleted original schedule:', deletedSchedule?._id, 'from date', originalDate);
      
      // Create/update the new schedule for the rescheduled date
      const newScheduleDate = new Date(request.newSchedule.date);
      newScheduleDate.setHours(0, 0, 0, 0);
      
      // Check if schedule already exists for the new date
      let newSchedule = await DoctorSchedule.findOne({
        doctor_id: originalSchedule.doctor_id,
        date: newScheduleDate
      });
      
      if (newSchedule) {
        // Update existing schedule
        newSchedule = await DoctorSchedule.findByIdAndUpdate(newSchedule._id, {
        is_available: request.newSchedule.isAvailable,
        working_hours: request.newSchedule.workingHours,
        break_time: request.newSchedule.breakTime,
        slot_duration: request.newSchedule.slotDuration,
          max_patients_per_slot: 20,
        leave_reason: request.newSchedule.leaveReason,
          notes: `Rescheduled from ${originalSchedule.date.toISOString().split('T')[0]} to ${request.newSchedule.date}`,
        updated_at: new Date()
      }, { new: true });
        console.log('✅ Updated existing schedule:', newSchedule?._id, 'for date', newScheduleDate);
      } else {
        // Create new schedule for the new date
        newSchedule = new DoctorSchedule({
          doctor_id: originalSchedule.doctor_id,
          date: newScheduleDate,
          is_available: request.newSchedule.isAvailable,
          working_hours: request.newSchedule.workingHours,
          break_time: request.newSchedule.breakTime,
          slot_duration: request.newSchedule.slotDuration,
          max_patients_per_slot: 20,
          leave_reason: request.newSchedule.leaveReason,
          notes: `Rescheduled from ${originalSchedule.date.toISOString().split('T')[0]} to ${request.newSchedule.date}`,
          created_at: new Date(),
          updated_at: new Date()
        });
        await newSchedule.save();
        console.log('✅ Created new schedule:', newSchedule?._id, 'for date', newScheduleDate);
      }
      } catch (rescheduleError) {
        console.error('❌ Error processing reschedule request:', rescheduleError);
        return res.status(500).json({ success: false, message: 'Failed to process reschedule request: ' + rescheduleError.message });
      }
    }

    // Remove the request from the array
    global.scheduleRequests = global.scheduleRequests.filter(r => r.id !== requestId);

    // Notify real-time updates
    if (global.realtimeSyncService) {
      global.realtimeSyncService.notifyScheduleUpdate(request.doctorId, {
        type: 'schedule_updated',
        requestType: request.type,
        doctorId: request.doctorId
      });
    }

    res.json({ success: true, message: 'Schedule request approved successfully' });
  } catch (error) {
    console.error('Error approving schedule request:', error);
    res.status(500).json({ success: false, message: 'Failed to approve schedule request' });
  }
});

// Reject schedule request
router.post('/schedule-requests/:requestId/reject', adminMiddleware, async (req, res) => {
  try {
    const { requestId } = req.params;
    const scheduleRequests = global.scheduleRequests || [];
    const request = scheduleRequests.find(r => r.id === requestId);
    
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // Remove the request from the array
    global.scheduleRequests = global.scheduleRequests.filter(r => r.id !== requestId);

    res.json({ success: true, message: 'Schedule request rejected successfully' });
  } catch (error) {
    console.error('Error rejecting schedule request:', error);
    res.status(500).json({ success: false, message: 'Failed to reject schedule request' });
  }
});

// ==================== AUTOMATIC APPOINTMENT CANCELLATION ENDPOINTS ====================

// Get cron service status
router.get('/cron/status', extractToken, async (req, res) => {
  try {
    const status = cronService.getStatus();
    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('Error getting cron status:', error);
    res.status(500).json({ success: false, message: 'Failed to get cron status' });
  }
});

// Manually trigger cancellation check
router.post('/cron/trigger-cancellation', extractToken, async (req, res) => {
  try {
    console.log('🔧 Admin manually triggered cancellation check');
    await cronService.triggerCancellationCheck();
    
    res.json({
      success: true,
      message: 'Cancellation check triggered successfully'
    });
  } catch (error) {
    console.error('Error triggering cancellation check:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger cancellation check' });
  }
});

// Manually cancel all past appointments
router.post('/cron/cancel-past-appointments', extractToken, async (req, res) => {
  try {
    console.log('🔧 Admin manually triggered past appointments cancellation');
    const appointmentCancellationService = require('../services/appointmentCancellationService');
    const cancelledCount = await appointmentCancellationService.cancelPreviousDaysAppointments();
    
    res.json({
      success: true,
      message: `Successfully cancelled ${cancelledCount} past appointments`,
      cancelledCount
    });
  } catch (error) {
    console.error('Error cancelling past appointments:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel past appointments' });
  }
});

// Get cancellation statistics
router.get('/cron/cancellation-stats', extractToken, async (req, res) => {
  try {
    const stats = await cronService.getCancellationStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting cancellation stats:', error);
    res.status(500).json({ success: false, message: 'Failed to get cancellation stats' });
  }
});

// Start cron service
router.post('/cron/start', extractToken, async (req, res) => {
  try {
    cronService.start();
    res.json({
      success: true,
      message: 'Cron service started successfully'
    });
  } catch (error) {
    console.error('Error starting cron service:', error);
    res.status(500).json({ success: false, message: 'Failed to start cron service' });
  }
});

// Stop cron service
router.post('/cron/stop', extractToken, async (req, res) => {
  try {
    cronService.stop();
    res.json({
      success: true,
      message: 'Cron service stopped successfully'
    });
  } catch (error) {
    console.error('Error stopping cron service:', error);
    res.status(500).json({ success: false, message: 'Failed to stop cron service' });
  }
});

module.exports = router;




