const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { User, PasswordResetToken } = require('../models/User');
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
    const patients = await User.find({}).select('-password');
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Get all doctors
router.get('/doctors', adminMiddleware, async (req, res) => {
  try {
    const doctors = await User.find({ role: 'doctor' })
      .select('-password')
      .sort({ createdAt: -1 });
    res.json(doctors);
  } catch (error) {
    console.error('Get doctors error:', error);
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

// Create user (Admin only)
router.post('/users', adminMiddleware, async (req, res) => {
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
    
    // Send credentials email
    await sendAccountCredentialsEmail(email, tempPassword, role, name);
    
    const userResponse = await User.findById(user._id).select('-password');
    res.status(201).json({
      user: userResponse,
      message: `${role} account created successfully. Login credentials sent to ${email}`
    });
    
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;




