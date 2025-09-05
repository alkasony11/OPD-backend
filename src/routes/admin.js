const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { User, PasswordResetToken, OTP } = require('../models/User');
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
    const verifiedUsers = await User.countDocuments({ isVerified: true });
    const recentUsers = await User.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });

    // Mock appointment data (you can replace with actual appointment model)
    const mockAppointmentStats = {
      totalAppointments: 156,
      todayAppointments: 12,
      pendingAppointments: 8,
      completedAppointments: 134
    };

    res.json({
      users: {
        total: totalUsers,
        verified: verifiedUsers,
        recent: recentUsers,
        unverified: totalUsers - verifiedUsers
      },
      appointments: mockAppointmentStats,
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
    const patients = await User.find({ role: 'patient' })
      .select('-password')
      .sort({ createdAt: -1 });
    res.json(patients);
  } catch (err) {
    console.error('Get patients error:', err);
    res.status(500).json({ error: 'Failed to fetch patients' });
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
        notes: schedule.notes
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
      notes
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

    if (schedule) {
      // Update existing schedule
      schedule.is_available = isAvailable !== undefined ? isAvailable : schedule.is_available;
      schedule.working_hours = workingHours || schedule.working_hours;
      schedule.break_time = breakTime || schedule.break_time;
      schedule.slot_duration = slotDuration || schedule.slot_duration;
      schedule.max_patients_per_slot = maxPatientsPerSlot || schedule.max_patients_per_slot;
      schedule.leave_reason = leaveReason || schedule.leave_reason;
      schedule.notes = notes || schedule.notes;
      
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
        notes: notes || ''
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
        notes: schedule.notes
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
          max_patients_per_slot: scheduleTemplate.maxPatientsPerSlot || 1
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




