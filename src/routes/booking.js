const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User } = require('../models/User');
const { 
  Department, 
  Doctor, 
  FamilyMember, 
  Appointment, 
  Payment, 
  Notification 
} = require('../models/Appointment');

const router = express.Router();

// Authentication middleware
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, 'your_jwt_secret');
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// Helper function to generate token number
const generateTokenNumber = async (doctorId, appointmentDate) => {
  const date = new Date(appointmentDate);
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  
  const count = await Appointment.countDocuments({
    doctorId,
    appointmentDate: {
      $gte: new Date(date.setHours(0, 0, 0, 0)),
      $lt: new Date(date.setHours(23, 59, 59, 999))
    }
  });
  
  return `${dateStr}${doctorId.toString().slice(-4)}${(count + 1).toString().padStart(3, '0')}`;
};

// Helper function to calculate estimated wait time using AI-like logic
const calculateEstimatedWaitTime = async (doctorId, appointmentDate, appointmentTime) => {
  try {
    const doctor = await Doctor.findById(doctorId);
    if (!doctor) return 30; // Default 30 minutes

    const date = new Date(appointmentDate);
    const [hours, minutes] = appointmentTime.split(':');
    const appointmentDateTime = new Date(date.setHours(parseInt(hours), parseInt(minutes), 0, 0));

    // Get appointments before this time slot
    const previousAppointments = await Appointment.find({
      doctorId,
      appointmentDate: {
        $gte: new Date(date.setHours(0, 0, 0, 0)),
        $lt: appointmentDateTime
      },
      status: { $in: ['confirmed', 'pending'] }
    }).sort({ appointmentTime: 1 });

    // Calculate base wait time
    const avgConsultationTime = doctor.avgConsultationTime || 15;
    const queueLength = previousAppointments.length;
    
    // AI-like factors
    const timeOfDay = parseInt(hours);
    const isRushHour = (timeOfDay >= 9 && timeOfDay <= 11) || (timeOfDay >= 16 && timeOfDay <= 18);
    const rushHourMultiplier = isRushHour ? 1.3 : 1.0;
    
    // Day of week factor
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const weekendMultiplier = isWeekend ? 0.8 : 1.0;
    
    // Calculate estimated wait time
    let estimatedWait = queueLength * avgConsultationTime * rushHourMultiplier * weekendMultiplier;
    
    // Add buffer time (5-15 minutes)
    estimatedWait += Math.random() * 10 + 5;
    
    return Math.round(estimatedWait);
  } catch (error) {
    console.error('Error calculating wait time:', error);
    return 30; // Default fallback
  }
};

// Get all departments
router.get('/departments', async (req, res) => {
  try {
    const departments = await Department.find({ isActive: true }).sort({ name: 1 });
    res.json(departments);
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get doctors by department
router.get('/doctors/:departmentId', async (req, res) => {
  try {
    const { departmentId } = req.params;
    const doctors = await Doctor.find({ 
      department: departmentId, 
      isActive: true 
    }).populate('department').sort({ name: 1 });
    
    res.json(doctors);
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get available time slots for a doctor on a specific date
router.get('/slots/:doctorId/:date', async (req, res) => {
  try {
    const { doctorId, date } = req.params;
    
    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const appointmentDate = new Date(date);
    const dayName = appointmentDate.toLocaleDateString('en-US', { weekday: 'long' });
    
    // Find doctor's availability for this day
    const daySlot = doctor.availableSlots.find(slot => slot.day === dayName);
    if (!daySlot) {
      return res.json({ availableSlots: [] });
    }

    // Get existing appointments for this date
    const existingAppointments = await Appointment.find({
      doctorId,
      appointmentDate: {
        $gte: new Date(appointmentDate.setHours(0, 0, 0, 0)),
        $lt: new Date(appointmentDate.setHours(23, 59, 59, 999))
      },
      status: { $in: ['confirmed', 'pending'] }
    });

    // Generate time slots
    const slots = [];
    const startTime = daySlot.startTime;
    const endTime = daySlot.endTime;
    const slotDuration = 30; // 30 minutes per slot
    
    let currentTime = new Date(`2000-01-01 ${startTime}`);
    const endDateTime = new Date(`2000-01-01 ${endTime}`);
    
    while (currentTime < endDateTime) {
      const timeString = currentTime.toTimeString().slice(0, 5);
      const isBooked = existingAppointments.some(apt => apt.appointmentTime === timeString);
      
      if (!isBooked) {
        slots.push({
          time: timeString,
          available: true,
          estimatedWaitTime: await calculateEstimatedWaitTime(doctorId, date, timeString)
        });
      }
      
      currentTime.setMinutes(currentTime.getMinutes() + slotDuration);
    }

    res.json({ availableSlots: slots });
  } catch (error) {
    console.error('Get slots error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get family members
router.get('/family-members', authMiddleware, async (req, res) => {
  try {
    const familyMembers = await FamilyMember.find({ 
      userId: req.user._id, 
      isActive: true 
    }).sort({ relation: 1, name: 1 });
    
    res.json(familyMembers);
  } catch (error) {
    console.error('Get family members error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add family member
router.post('/family-members', authMiddleware, async (req, res) => {
  try {
    const familyMember = new FamilyMember({
      ...req.body,
      userId: req.user._id
    });
    
    await familyMember.save();
    res.status(201).json(familyMember);
  } catch (error) {
    console.error('Add family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update family member
router.put('/family-members/:id', authMiddleware, async (req, res) => {
  try {
    const familyMember = await FamilyMember.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    
    if (!familyMember) {
      return res.status(404).json({ message: 'Family member not found' });
    }
    
    res.json(familyMember);
  } catch (error) {
    console.error('Update family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete family member
router.delete('/family-members/:id', authMiddleware, async (req, res) => {
  try {
    const familyMember = await FamilyMember.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isActive: false },
      { new: true }
    );
    
    if (!familyMember) {
      return res.status(404).json({ message: 'Family member not found' });
    }
    
    res.json({ message: 'Family member deleted successfully' });
  } catch (error) {
    console.error('Delete family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Book appointment
router.post('/appointments', authMiddleware, async (req, res) => {
  try {
    const {
      familyMemberId,
      doctorId,
      departmentId,
      appointmentDate,
      appointmentTime,
      symptoms,
      paymentMethod
    } = req.body;

    // Validate family member belongs to user
    const familyMember = await FamilyMember.findOne({
      _id: familyMemberId,
      userId: req.user._id,
      isActive: true
    });

    if (!familyMember) {
      return res.status(400).json({ message: 'Invalid family member' });
    }

    // Check for overlapping appointments for the same family member
    const existingAppointment = await Appointment.findOne({
      familyMemberId,
      appointmentDate: new Date(appointmentDate),
      status: { $in: ['pending', 'confirmed'] }
    });

    if (existingAppointment) {
      return res.status(400).json({
        message: 'This family member already has an appointment on this date'
      });
    }

    // Get doctor and calculate consultation fee
    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    // Generate token number
    const tokenNumber = await generateTokenNumber(doctorId, appointmentDate);

    // Calculate estimated wait time
    const estimatedWaitTime = await calculateEstimatedWaitTime(
      doctorId,
      appointmentDate,
      appointmentTime
    );

    // Create appointment
    const appointment = new Appointment({
      tokenNumber,
      userId: req.user._id,
      familyMemberId,
      doctorId,
      departmentId,
      appointmentDate: new Date(appointmentDate),
      appointmentTime,
      symptoms,
      estimatedWaitTime,
      queuePosition: await Appointment.countDocuments({
        doctorId,
        appointmentDate: new Date(appointmentDate),
        status: { $in: ['pending', 'confirmed'] }
      }) + 1
    });

    // Create payment record
    const payment = new Payment({
      appointmentId: appointment._id,
      userId: req.user._id,
      amount: doctor.consultationFee,
      paymentMethod,
      transactionId: `TXN_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`
    });

    // Save both appointment and payment
    await appointment.save();
    await payment.save();

    // Update appointment with payment ID
    appointment.paymentId = payment._id;
    await appointment.save();

    // Create notification
    const notification = new Notification({
      userId: req.user._id,
      appointmentId: appointment._id,
      type: 'booking_confirmed',
      title: 'Appointment Booked Successfully',
      message: `Your appointment with ${doctor.name} has been confirmed for ${appointmentDate} at ${appointmentTime}. Token: ${tokenNumber}`,
      channels: ['dashboard', 'sms', 'email']
    });
    await notification.save();

    // Populate appointment data for response
    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate('doctorId', 'name specialization consultationFee')
      .populate('departmentId', 'name')
      .populate('familyMemberId', 'name relation age')
      .populate('paymentId');

    res.status(201).json({
      appointment: populatedAppointment,
      message: 'Appointment booked successfully'
    });

  } catch (error) {
    console.error('Book appointment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user appointments
router.get('/appointments', authMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const query = { userId: req.user._id };
    if (status) {
      query.status = status;
    }

    const appointments = await Appointment.find(query)
      .populate('doctorId', 'name specialization profileImage')
      .populate('departmentId', 'name')
      .populate('familyMemberId', 'name relation age')
      .populate('paymentId', 'amount paymentStatus transactionId')
      .sort({ appointmentDate: -1, appointmentTime: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Appointment.countDocuments(query);

    res.json({
      appointments,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get appointment details
router.get('/appointments/:id', authMiddleware, async (req, res) => {
  try {
    const appointment = await Appointment.findOne({
      _id: req.params.id,
      userId: req.user._id
    })
      .populate('doctorId')
      .populate('departmentId')
      .populate('familyMemberId')
      .populate('paymentId');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    res.json(appointment);
  } catch (error) {
    console.error('Get appointment details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Cancel appointment
router.put('/appointments/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;

    const appointment = await Appointment.findOne({
      _id: req.params.id,
      userId: req.user._id,
      status: { $in: ['pending', 'confirmed'] }
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found or cannot be cancelled' });
    }

    // Update appointment status
    appointment.status = 'cancelled';
    appointment.cancellationReason = reason || 'Cancelled by patient';
    appointment.cancellationDate = new Date();
    await appointment.save();

    // Process refund if payment was made
    if (appointment.paymentId) {
      const payment = await Payment.findById(appointment.paymentId);
      if (payment && payment.paymentStatus === 'completed') {
        payment.paymentStatus = 'refunded';
        payment.refundAmount = payment.amount;
        payment.refundReason = 'Appointment cancelled';
        payment.refundDate = new Date();
        await payment.save();
      }
    }

    // Create notification
    const notification = new Notification({
      userId: req.user._id,
      appointmentId: appointment._id,
      type: 'appointment_cancelled',
      title: 'Appointment Cancelled',
      message: `Your appointment (Token: ${appointment.tokenNumber}) has been cancelled successfully. Refund will be processed within 3-5 business days.`,
      channels: ['dashboard', 'sms', 'email']
    });
    await notification.save();

    res.json({ message: 'Appointment cancelled successfully' });
  } catch (error) {
    console.error('Cancel appointment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get notifications
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const notifications = await Notification.find({ userId: req.user._id })
      .populate('appointmentId', 'tokenNumber appointmentDate appointmentTime')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      isRead: false
    });

    res.json({
      notifications,
      unreadCount
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark notification as read
router.put('/notifications/:id/read', authMiddleware, async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isRead: true }
    );

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
