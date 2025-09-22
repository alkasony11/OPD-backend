const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { User, PasswordResetToken, OTP, Token } = require('../models/User');
const LeaveRequest = require('../models/LeaveRequest');
const Department = require('../models/Department');
const DoctorSchedule = require('../models/DoctorSchedule');
const { transporter } = require('../config/email');
const { extractToken } = require('../middleware/authMiddleware');

const router = express.Router();

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

// Get all users (Admin only)
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const users = await User.find({})
      .select('-password')
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
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

// Get single patient details
router.get('/patients/:patientId', adminMiddleware, async (req, res) => {
  try {
    const { patientId } = req.params;
    
    const patient = await User.findOne({ 
      role: 'patient', 
      $or: [
        { patientId: patientId },
        { _id: patientId }
      ]
    }).select('-password');
    
    if (!patient) {
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
    
    // Get family members
    const familyMembers = await mongoose.model('FamilyMember').find({ patient_id: patient._id });
    
    res.json({ familyMembers });
  } catch (error) {
    console.error('Get patient family error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Block/Unblock patient
router.put('/patients/:patientId/block', adminMiddleware, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { blocked, reason } = req.body;
    
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
    appointment.status = 'cancelled';
    appointment.cancellation_reason = reason || 'Cancelled by admin';
    appointment.cancelled_by = 'admin';
    appointment.cancelled_at = new Date();
    await appointment.save();

    res.json({ message: 'Appointment cancelled successfully' });
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

    res.json({ message: 'Appointment rescheduled successfully' });
  } catch (error) {
    console.error('Admin reschedule appointment error:', error);
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
      qualifications,
      bio 
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
        qualifications: qualifications || '',
        bio: bio || '',
        calendar: [],
        status: 'active',
        default_working_hours: {
          start_time: '09:00',
          end_time: '17:00'
        },
        default_break_time: {
          start_time: '13:00',
          end_time: '14:00'
        },
        default_slot_duration: 30
      };
    } else if (role === 'receptionist') {
      userData.receptionist_info = {
        department: department || null
      };
    }

    const user = new User(userData);
    await user.save();

    console.log('User created successfully:', user._id);

    // Create initial schedule for the next 30 days for doctors
    if (role === 'doctor') {
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
        max_patients_per_slot: 1,
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
        max_patients_per_slot: maxPatientsPerSlot || 1,
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
    const leaves = await LeaveRequest.find(query).populate('doctor_id', 'name email');
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
    
    const leave = await LeaveRequest.findById(id);
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

    // Ensure schedule is marked unavailable for that date
    const scheduleDate = new Date(
      new Date(leave.date).getFullYear(),
      new Date(leave.date).getMonth(),
      new Date(leave.date).getDate(),
      0, 0, 0, 0
    );
    console.log('Schedule date:', scheduleDate);

    let schedule = await DoctorSchedule.findOne({ doctor_id: leave.doctor_id, date: scheduleDate });
    console.log('Existing schedule found:', !!schedule);
    
    if (!schedule) {
      console.log('Creating new schedule for leave date');
      schedule = new DoctorSchedule({
        doctor_id: leave.doctor_id,
        date: scheduleDate,
        is_available: false,
        working_hours: { start_time: '09:00', end_time: '17:00' },
        break_time: { start_time: '13:00', end_time: '14:00' },
        slot_duration: 30,
        max_patients_per_slot: 1,
        leave_reason: leave.reason || 'Approved leave',
        notes: 'Auto-set by admin leave approval'
      });
    } else {
      console.log('Updating existing schedule');
      schedule.is_available = false;
      schedule.leave_reason = leave.reason || 'Approved leave';
    }
    
    await schedule.save();
    console.log('Schedule saved successfully');

    // Cancel or disable tokens for that date
    const nextDay = new Date(scheduleDate);
    nextDay.setDate(nextDay.getDate() + 1);
    
    const tokenUpdateResult = await Token.updateMany(
      {
        doctor_id: leave.doctor_id,
        booking_date: { $gte: scheduleDate, $lt: nextDay },
        status: { $in: ['booked', 'in_queue'] }
      },
      { $set: { status: 'cancelled' } }
    );
    
    console.log('Tokens updated:', tokenUpdateResult);

    res.json({ 
      message: 'Leave approved and day blocked', 
      leave: {
        _id: leave._id,
        status: leave.status,
        admin_comment: leave.admin_comment
      }
    });
  } catch (error) {
    console.error('Approve leave request error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Server error', 
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Reject a leave request
router.post('/leave-requests/:id/reject', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_comment } = req.body;
    
    console.log('Rejecting leave request:', id, 'with comment:', admin_comment);
    
    const leave = await LeaveRequest.findById(id);
    if (!leave) {
      console.log('Leave request not found:', id);
      return res.status(404).json({ message: 'Leave request not found' });
    }

    console.log('Found leave request:', leave);

    leave.status = 'rejected';
    if (admin_comment) leave.admin_comment = admin_comment;
    await leave.save();
    console.log('Leave request rejected successfully');

    res.json({ 
      message: 'Leave rejected', 
      leave: {
        _id: leave._id,
        status: leave.status,
        admin_comment: leave.admin_comment
      }
    });
  } catch (error) {
    console.error('Reject leave request error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Server error', 
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
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
          max_patients_per_slot: scheduleTemplate.maxPatientsPerSlot || 1,
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

module.exports = router;




