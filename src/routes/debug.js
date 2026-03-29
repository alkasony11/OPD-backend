const express = require('express');
const router = express.Router();
const { User } = require('../models/User');
const { authMiddleware } = require('../middleware/authMiddleware');

// Debug endpoint to check user role and details
router.get('/user-role', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        patientId: user.patientId,
        isVerified: user.isVerified,
        authProvider: user.authProvider,
        clerkId: user.clerkId
      },
      message: 'User role information retrieved successfully'
    });
  } catch (error) {
    console.error('Debug user role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Debug endpoint to update user role (for fixing role issues)
router.put('/update-role', authMiddleware, async (req, res) => {
  try {
    const { newRole } = req.body;
    
    if (!['patient', 'doctor', 'receptionist', 'admin'].includes(newRole)) {
      return res.status(400).json({ message: 'Invalid role. Must be patient, doctor, receptionist, or admin.' });
    }

    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const oldRole = user.role;
    user.role = newRole;
    
    // Add role-specific info if needed
    if (newRole === 'patient' && !user.patient_info) {
      user.patient_info = {
        family_members: [],
        booking_history: []
      };
    } else if (newRole === 'doctor' && !user.doctor_info) {
      user.doctor_info = {
        department: '',
        specialization: '',
        experience_years: 0,
        calendar: [],
        status: 'active'
      };
    } else if (newRole === 'admin' && !user.admin_info) {
      user.admin_info = {
        permissions: ['all']
      };
    } else if (newRole === 'receptionist' && !user.receptionist_info) {
      user.receptionist_info = {
        department: ''
      };
    }

    await user.save();

    res.json({
      message: `User role updated from ${oldRole} to ${newRole} successfully`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Debug endpoint to list all users (for admin debugging)
router.get('/all-users', authMiddleware, async (req, res) => {
  try {
    const users = await User.find({}).select('name email role patientId isVerified authProvider').sort({ createdAt: -1 });
    
    res.json({
      users: users.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        patientId: user.patientId,
        isVerified: user.isVerified,
        authProvider: user.authProvider
      })),
      count: users.length
    });
  } catch (error) {
    console.error('Debug all users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
