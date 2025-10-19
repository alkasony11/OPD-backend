const express = require('express');
const router = express.Router();
const { User, Appointment, Token } = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const DoctorSchedule = require('../models/DoctorSchedule');
const LeaveRequest = require('../models/LeaveRequest');
const DoctorStats = require('../models/DoctorStats');
const DoctorStatsService = require('../services/doctorStatsService');
const CloudinaryService = require('../services/cloudinaryService');
const { authMiddleware } = require('../middleware/authMiddleware');
const ConsultationRecord = require('../models/ConsultationRecord');

// Helper: parse local date string in formats: YYYY-MM-DD or DD-MM-YYYY
function parseLocalYMD(input) {
  if (!input || typeof input !== 'string') return null;
  const parts = input.split('-');
  if (parts.length !== 3) return null;

  let year, month, day;
  // If first part has 4 digits, assume YYYY-MM-DD
  if (parts[0].length === 4) {
    year = Number(parts[0]);
    month = Number(parts[1]) - 1;
    day = Number(parts[2]);
  } else {
    // Assume DD-MM-YYYY
    day = Number(parts[0]);
    month = Number(parts[1]) - 1;
    year = Number(parts[2]);
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const d = new Date(year, month, day);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

// Doctor role guard
// Multer storage for qualification/certification documents
const docStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../../uploads/doctor-docs');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'doc-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const docUpload = multer({
  storage: docStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: function (req, file, cb) {
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (allowed.includes(file.mimetype)) cb(null, true); else cb(new Error('Only PDF/JPG/PNG allowed'));
  }
});

// Multer configuration for doctor profile photos (memory storage for Cloudinary)
const profilePhotoStorage = multer.memoryStorage();

const profilePhotoUpload = multer({
  storage: profilePhotoStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Only allow JPG and PNG files
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG and PNG files are allowed'), false);
    }
  }
});

// Upload qualification/certification proof (defined after doctorMiddleware)
const doctorMiddleware = async (req, res, next) => {
  try {
    console.log('🔍 Doctor middleware - req.user:', req.user);
    console.log('🔍 Doctor middleware - req.user.userId:', req.user?.userId);
    
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    const user = await User.findById(req.user.userId);
    console.log('🔍 Doctor middleware - found user:', user);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (user.role !== 'doctor') {
      return res.status(403).json({ message: 'Access denied. Doctor role required.' });
    }
    
    req.doctor = user;
    console.log('✅ Doctor middleware - req.doctor set:', req.doctor._id);
    next();
  } catch (error) {
    console.error('❌ Doctor middleware error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Upload qualification/certification proof (now safely after doctorMiddleware definition)
router.post('/upload-proof', authMiddleware, doctorMiddleware, docUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'File is required' });
    const fileUrl = `/uploads/doctor-docs/${req.file.filename}`;
    res.json({ message: 'Uploaded', fileUrl });
  } catch (error) {
    console.error('Upload proof error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Leave Requests
// Doctor submits a leave request
router.post('/leave-requests', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    console.log('📝 Leave request received:', req.body);
    console.log('👨‍⚕️ Doctor ID:', req.doctor?._id);
    console.log('👤 User ID:', req.user?.userId);
    
    const { leave_type, start_date, end_date, session, reason, date } = req.body;

    // Backward compatibility: accept legacy payload { date, reason }
    const effectiveLeaveType = leave_type || (date ? 'full_day' : undefined);
    const effectiveStartDateStr = start_date || date;
    const effectiveEndDateStr = end_date || date;

    if (!effectiveStartDateStr) return res.status(400).json({ message: 'Start date is required' });
    if (effectiveLeaveType === 'full_day' && !effectiveEndDateStr) {
      return res.status(400).json({ message: 'End date is required for full day leave' });
    }

    const startDate = parseLocalYMD(effectiveStartDateStr);
    const endDate = effectiveLeaveType === 'full_day' ? parseLocalYMD(effectiveEndDateStr) : startDate;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Invalid date format. Use DD-MM-YYYY or YYYY-MM-DD' });
    }
    
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    
    console.log('📅 Parsed dates:', { startDate, endDate });

    // Check for overlapping leave requests
    const existingLeave = await LeaveRequest.findOne({
      doctor_id: req.doctor._id,
      status: { $in: ['pending', 'approved'] },
      $or: [
        {
          start_date: { $lte: endDate },
          end_date: { $gte: startDate }
        }
      ]
    });

    if (existingLeave) {
      return res.status(400).json({ 
        message: 'You already have a leave request for this date range' 
      });
    }

    console.log('🔄 Creating leave request with data:', {
      doctor_id: req.doctor._id,
      leave_type: effectiveLeaveType || 'full_day',
      start_date: startDate,
      end_date: endDate,
      session: (effectiveLeaveType === 'half_day') ? (session || 'morning') : 'morning',
      reason: reason || '',
      status: 'pending'
    });

    const leave = new LeaveRequest({
      doctor_id: req.doctor._id,
      leave_type: effectiveLeaveType || 'full_day',
      start_date: startDate,
      end_date: endDate,
      session: (effectiveLeaveType === 'half_day') ? (session || 'morning') : 'morning',
      reason: reason || '',
      status: 'pending'
    });

    console.log('💾 Saving leave request...');
    await leave.save();
    console.log('✅ Leave request saved successfully:', leave._id);

    res.json({ message: 'Leave request submitted successfully', leaveRequest: leave });
  } catch (error) {
    console.error('Submit leave request error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: String(error?.message || error),
      code: error?.code || undefined
    });
  }
});

// Doctor lists their leave requests
router.get('/leave-requests', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    const query = { doctor_id: req.doctor._id };
    if (status) query.status = status;
    
    const leaveRequests = await LeaveRequest.find(query)
      .sort({ start_date: -1, createdAt: -1 });
    
    res.json({ leaveRequests });
  } catch (error) {
    console.error('List leave requests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Doctor cancels their own leave request
router.put('/leave-requests/:id/cancel', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const leave = await LeaveRequest.findOne({ 
      _id: id, 
      doctor_id: req.doctor._id,
      status: 'pending'
    });
    
    if (!leave) {
      return res.status(404).json({ 
        message: 'Leave request not found or cannot be cancelled' 
      });
    }
    
    leave.status = 'cancelled';
    leave.cancelled_at = new Date();
    leave.cancelled_by = 'doctor';
    await leave.save();
    
    res.json({ message: 'Leave request cancelled successfully' });
  } catch (error) {
    console.error('Cancel leave request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// (middleware defined above)

// Debug endpoint to check database contents
router.get('/debug-appointments', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;
    
    // Get all tokens for this doctor
    const allTokens = await Token.find({ doctor_id: doctorId }).limit(10);
    
    // Get all tokens in database
    const allTokensInDB = await Token.find({}).limit(10);
    
    // Get doctor info
    const doctor = await User.findById(doctorId);
    
    res.json({
      doctorId,
      doctorName: doctor?.name,
      doctorEmail: doctor?.email,
      tokensForThisDoctor: allTokens.length,
      allTokensInDB: allTokensInDB.length,
      sampleTokens: allTokensInDB.map(t => ({
        id: t._id,
        doctor_id: t.doctor_id,
        patient_name: t.patient_name,
        status: t.status,
        date: t.booking_date
      }))
    });
  } catch (error) {
    console.error('Debug appointments error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get doctor's appointments from tokens collection
router.get('/appointments', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { filter = 'today', page = 1, limit = 10, date } = req.query;
    const doctorId = req.doctor._id;
    
    console.log('🔍 Fetching appointments for doctor:', doctorId);
    console.log('🔍 Filter:', filter, 'Page:', page, 'Limit:', limit);

    let dateFilter = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // If specific date is provided, use it
    if (date) {
      const selectedDate = parseLocalYMD(date) || new Date(date);
      selectedDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(selectedDate);
      nextDay.setDate(nextDay.getDate() + 1);
      
      dateFilter = {
        booking_date: {
          $gte: selectedDate,
          $lt: nextDay
        }
      };
    } else {
      switch (filter) {
        case 'today':
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          dateFilter = {
            booking_date: {
              $gte: today,
              $lt: tomorrow
            }
          };
          break;
        case 'upcoming':
          const upcomingStart = new Date(today);
          upcomingStart.setDate(upcomingStart.getDate() + 1);
          dateFilter = {
            booking_date: { $gte: upcomingStart }
          };
          break;
        case 'past':
          dateFilter = {
            booking_date: { $lt: today }
          };
          break;
        case 'all':
        default:
          // No date filter for 'all'
          break;
      }
    }

    const query = {
      doctor_id: doctorId,
      ...dateFilter
    };

    // Apply status filters based on the filter type
    if (filter === 'today') {
      // For 'today' filter, exclude cancelled, missed, and consulted appointments
      query.status = { $nin: ['cancelled', 'missed', 'consulted'] };
    } else if (filter === 'upcoming') {
      // For 'upcoming' filter, exclude cancelled, missed, and consulted appointments
      query.status = { $nin: ['cancelled', 'missed', 'consulted'] };
    } else if (filter === 'completed') {
      // For 'completed' filter, only show consulted appointments
      query.status = 'consulted';
    } else if (filter === 'cancelled') {
      // For 'cancelled' filter, show cancelled and missed appointments
      query.status = { $in: ['cancelled', 'missed'] };
    } else if (filter === 'all') {
      // For 'all' filter, exclude cancelled, missed, and consulted appointments
      query.status = { $nin: ['cancelled', 'missed', 'consulted'] };
    }
    
    console.log('🔍 Query:', JSON.stringify(query, null, 2));
    
    const appointments = await Token.find(query)
    .populate('patient_id', 'name email phone patient_info')
    .populate('family_member_id', 'name relation patientId')
    .sort({ booking_date: 1, time_slot: 1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
    
    console.log('🔍 Found appointments:', appointments.length);

    const totalAppointments = await Token.countDocuments({
      doctor_id: doctorId,
      ...dateFilter
    });

    // Transform to match expected format
    const transformedAppointments = appointments.map(apt => ({
      _id: apt._id,
      patient_name: apt.family_member_id ? apt.family_member_id.name : (apt.patient_id?.name || 'Unknown Patient'),
      patientName: apt.family_member_id ? apt.family_member_id.name : (apt.patient_id?.name || 'Unknown Patient'),
      patientEmail: apt.patient_id?.email || '',
      patientPhone: apt.patient_id?.phone || '',
      booking_date: apt.booking_date,
      appointmentDate: apt.booking_date,
      time_slot: apt.time_slot,
      appointmentTime: apt.time_slot,
      // Use stored appointment type if available (video/in-person)
      appointmentType: apt.appointment_type || 'consultation',
      status: apt.status,
      symptoms: apt.symptoms,
      doctorNotes: '', // Not in tokens collection
      diagnosis: '', // Not in tokens collection
      token_number: apt.token_number,
      tokenNumber: apt.token_number,
      department: apt.department,
      payment_status: apt.payment_status,
      paymentStatus: apt.payment_status,
      estimated_wait_time: apt.estimated_wait_time,
      estimatedWaitTime: apt.estimated_wait_time,
      // Surface meeting link for video consultations
      meeting_link: apt.meeting_link || null
    }));

    res.json({
      appointments: transformedAppointments,
      totalPages: Math.ceil(totalAppointments / limit),
      currentPage: page,
      totalAppointments
    });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get today's queue grouped by session (morning/afternoon/evening)
router.get('/today-queue', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Fetch today's tokens for this doctor
    const tokens = await Token.find({
      doctor_id: doctorId,
      booking_date: { $gte: today, $lt: tomorrow }
    })
    .populate('patient_id', 'name patient_info')
    .populate('family_member_id', 'name relation')
    .sort({ time_slot: 1, createdAt: 1 });

    const toMinutes = (t) => {
      if (!t || typeof t !== 'string') return 0;
      const [h, m] = t.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };

    const sessionOf = (time) => {
      const mins = toMinutes(time);
      if (mins >= 9 * 60 && mins < 13 * 60) return 'morning';
      if (mins >= 14 * 60 && mins < 18 * 60) return 'afternoon';
      return 'evening';
    };

    const result = { morning: [], afternoon: [], evening: [] };

    tokens.forEach((t) => {
      const patientName = t.family_member_id ? t.family_member_id.name : (t.patient_id?.name || 'Patient');
      const age = t.patient_id?.patient_info?.age || null;
      const gender = t.patient_id?.patient_info?.gender || null;
      const session = t.session_type || sessionOf(t.time_slot);
      result[session] = result[session] || [];
      result[session].push({
        id: t._id,
        tokenNumber: t.token_number,
        patientName,
        age,
        gender,
        symptoms: t.symptoms,
        bookingStatus: t.status,
        paymentStatus: t.payment_status,
        time: t.time_slot,
        appointmentType: t.appointment_type || 'consultation',
        meetingLink: t.meeting_link || null
      });
    });

    res.json({
      date: today.toISOString().split('T')[0],
      sessions: [
        { id: 'morning', name: 'Morning', range: '9:00 AM - 1:00 PM', queue: result.morning },
        { id: 'afternoon', name: 'Afternoon', range: '2:00 PM - 6:00 PM', queue: result.afternoon },
        { id: 'evening', name: 'Evening', range: '6:00 PM - 9:00 PM', queue: result.evening }
      ]
    });
  } catch (error) {
    console.error('Get today queue error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get next patient in today's queue (earliest time among booked/in_queue)
router.get('/next-patient', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const next = await Token.findOne({
      doctor_id: doctorId,
      booking_date: { $gte: today, $lt: tomorrow },
      status: { $in: ['booked', 'in_queue'] }
    })
    .populate('patient_id', 'name patient_info')
    .populate('family_member_id', 'name relation')
    .sort({ status: 1, time_slot: 1, createdAt: 1 });

    if (!next) {
      return res.json({ next: null });
    }

    const patientName = next.family_member_id ? next.family_member_id.name : (next.patient_id?.name || 'Patient');
    const age = next.patient_id?.patient_info?.age || null;
    const gender = next.patient_id?.patient_info?.gender || null;

    res.json({
      next: {
        id: next._id,
        tokenNumber: next.token_number,
        patientName,
        age,
        gender,
        symptoms: next.symptoms,
        status: next.status,
        time: next.time_slot,
        appointmentType: next.appointment_type || 'consultation',
        meetingLink: next.meeting_link || null
      }
    });
  } catch (error) {
    console.error('Get next patient error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Start consultation: mark token in_queue and set consultation_started_at
router.post('/consultation/start', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { tokenId } = req.body;
    if (!tokenId) return res.status(400).json({ message: 'tokenId is required' });

    const token = await Token.findOneAndUpdate(
      { _id: tokenId, doctor_id: req.doctor._id },
      { status: 'in_queue', consultation_started_at: new Date() },
      { new: true }
    );
    if (!token) return res.status(404).json({ message: 'Appointment not found' });
    res.json({ message: 'Consultation started', tokenId: token._id });
  } catch (error) {
    console.error('Start consultation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Skip / Call later: keep as booked, optionally bump updatedAt
router.post('/consultation/skip', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { tokenId } = req.body;
    if (!tokenId) return res.status(400).json({ message: 'tokenId is required' });
    // Touch document to move later in sort by createdAt (optional)
    await Token.findOneAndUpdate(
      { _id: tokenId, doctor_id: req.doctor._id },
      { $set: { updatedAt: new Date() } }
    );
    res.json({ message: 'Patient skipped' });
  } catch (error) {
    console.error('Skip consultation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark as no-show
router.post('/consultation/no-show', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { tokenId } = req.body;
    if (!tokenId) return res.status(400).json({ message: 'tokenId is required' });
    const token = await Token.findOneAndUpdate(
      { _id: tokenId, doctor_id: req.doctor._id },
      { status: 'missed' },
      { new: true }
    );
    if (!token) return res.status(404).json({ message: 'Appointment not found' });
    res.json({ message: 'Marked as no-show' });
  } catch (error) {
    console.error('No-show error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Complete consultation
router.post('/consultation/complete', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { tokenId, notes, diagnosis } = req.body;
    if (!tokenId) return res.status(400).json({ message: 'tokenId is required' });
    const update = { status: 'consulted', consultation_completed_at: new Date() };
    if (notes) update.consultation_notes = String(notes);
    if (diagnosis) update.diagnosis = String(diagnosis);

    const token = await Token.findOneAndUpdate(
      { _id: tokenId, doctor_id: req.doctor._id },
      update,
      { new: true }
    );
    if (!token) return res.status(404).json({ message: 'Appointment not found' });
    res.json({ message: 'Consultation completed' });
  } catch (error) {
    console.error('Complete consultation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get specific appointment details
router.get('/appointments/:appointmentId', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const appointment = await Appointment.findOne({
      _id: req.params.appointmentId,
      doctorId: req.doctor._id
    }).populate('patientId', 'name email phone dob gender patient_info');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    res.json(appointment);
  } catch (error) {
    console.error('Get appointment details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update appointment status in tokens collection
router.patch('/appointments/:appointmentId/status', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { status, notes, referredDoctor } = req.body;
    const validStatuses = ['booked', 'in_queue', 'consulted', 'cancelled', 'missed', 'referred'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const updateData = { status };
    if (notes) updateData.notes = notes;
    if (referredDoctor) updateData.referredDoctor = referredDoctor;
    if (status === 'consulted') updateData.consultation_completed_at = new Date();
    if (status === 'missed') updateData.no_show_at = new Date();

    const appointment = await Token.findOneAndUpdate(
      {
        _id: req.params.appointmentId,
        doctor_id: req.doctor._id
      },
      updateData,
      { new: true }
    ).populate('patient_id', 'name email phone');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Emit real-time appointment update event
    if (global.realtimeSyncService) {
      await global.realtimeSyncService.emitAppointmentUpdate(req.doctor._id, {
        appointmentId: appointment._id,
        status: appointment.status,
        patientName: appointment.patient_id?.name,
        bookingDate: appointment.booking_date,
        timeSlot: appointment.time_slot,
        referredDoctor: appointment.referredDoctor,
        updatedAt: new Date()
      });
    }

    res.json({ message: 'Appointment status updated successfully', appointment });
  } catch (error) {
    console.error('Update appointment status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add doctor notes to appointment
router.patch('/appointments/:appointmentId/notes', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { doctorNotes, diagnosis } = req.body;

    const appointment = await Appointment.findOneAndUpdate(
      {
        _id: req.params.appointmentId,
        doctorId: req.doctor._id
      },
      {
        doctorNotes: doctorNotes || '',
        diagnosis: diagnosis || ''
      },
      { new: true }
    ).populate('patientId', 'name email phone');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    res.json({ message: 'Notes updated successfully', appointment });
  } catch (error) {
    console.error('Update appointment notes error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add prescription to appointment
router.post('/appointments/:appointmentId/prescriptions', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { medicationName, dosage, frequency, duration, instructions } = req.body;

    if (!medicationName || !dosage || !frequency || !duration) {
      return res.status(400).json({ message: 'All prescription fields are required' });
    }

    const prescription = {
      medicationName,
      dosage,
      frequency,
      duration,
      instructions: instructions || '',
      prescribedAt: new Date()
    };

    const appointment = await Appointment.findOneAndUpdate(
      {
        _id: req.params.appointmentId,
        doctorId: req.doctor._id
      },
      {
        $push: { prescriptions: prescription }
      },
      { new: true }
    ).populate('patientId', 'name email phone');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    res.json({ message: 'Prescription added successfully', appointment });
  } catch (error) {
    console.error('Add prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get doctor's schedules
router.get('/schedules', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const doctorId = req.doctor._id;

    const query = { doctor_id: doctorId };
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const schedules = await DoctorSchedule.find(query).sort({ date: 1 });

    res.json({
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

// Get doctor dashboard statistics (enhanced with caching)
router.get('/stats', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;
    const { refresh } = req.query;

    let stats;
    if (refresh === 'true') {
      // Force refresh stats
      stats = await DoctorStatsService.refreshStats(doctorId);
    } else {
      // Get cached stats or calculate if expired
      stats = await DoctorStatsService.getStats(doctorId);
    }

    // Transform to match frontend expectations
    res.json({
      todayAppointments: stats.today_appointments,
      pendingAppointments: stats.today_pending,
      completedAppointments: stats.total_completed,
      totalPatients: stats.total_patients,
      
      // Additional stats
      monthAppointments: stats.month_appointments,
      monthCompleted: stats.month_completed,
      monthRevenue: stats.month_revenue,
      workingDaysThisMonth: stats.working_days_this_month,
      leaveDaysThisMonth: stats.leave_days_this_month,
      
      // Metadata
      lastUpdated: stats.last_calculated,
      cacheExpiresAt: stats.cache_expires_at
    });
  } catch (error) {
    console.error('Get doctor stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



// Create/Update doctor schedule
router.post('/schedules', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
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

    const doctorId = req.doctor._id;
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
        max_patients_per_slot: maxPatientsPerSlot || 20, // Default to 20 patients
        leave_reason: leaveReason || '',
        notes: notes || ''
      });
      
      await schedule.save();
    }

    // If doctor is marking as unavailable (leave), auto-disable tokens for that date
    if (!isAvailable) {
      await handleLeaveTokens(doctorId, scheduleDate);
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

// Helper function to handle tokens when doctor is on leave
async function handleLeaveTokens(doctorId, leaveDate) {
  try {
    const nextDay = new Date(leaveDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Find all tokens for this doctor on the leave date
    const tokens = await Token.find({
      doctor_id: doctorId,
      booking_date: {
        $gte: leaveDate,
        $lt: nextDay
      },
      status: { $in: ['booked', 'in_queue'] }
    }).populate('patient_id', 'name email phone');

    // Update tokens to cancelled status
    await Token.updateMany(
      {
        doctor_id: doctorId,
        booking_date: {
          $gte: leaveDate,
          $lt: nextDay
        },
        status: { $in: ['booked', 'in_queue'] }
      },
      {
        status: 'cancelled',
        $set: {
          cancellation_reason: 'Doctor unavailable - on leave'
        }
      }
    );

    console.log(`Cancelled ${tokens.length} tokens for doctor ${doctorId} on ${leaveDate.toDateString()}`);
    
    // Here you could add email notifications to patients about cancellation
    // For now, we'll just log it
    
    return tokens.length;
  } catch (error) {
    console.error('Error handling leave tokens:', error);
    throw error;
  }
}

// Update schedule entry
router.put('/schedules/:scheduleId', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const updates = req.body;
    const doctorId = req.doctor._id;

    const schedule = await DoctorSchedule.findOneAndUpdate(
      { _id: scheduleId, doctor_id: doctorId },
      updates,
      { new: true }
    );

    if (!schedule) {
      return res.status(404).json({ message: 'Schedule not found' });
    }

    res.json({ message: 'Schedule updated successfully', schedule });
  } catch (error) {
    console.error('Update schedule error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete schedule entry
router.delete('/schedules/:scheduleId', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const doctorId = req.doctor._id;

    const schedule = await DoctorSchedule.findOneAndDelete({
      _id: scheduleId,
      doctor_id: doctorId
    });

    if (!schedule) {
      return res.status(404).json({ message: 'Schedule not found' });
    }

    res.json({ message: 'Schedule deleted successfully' });
  } catch (error) {
    console.error('Delete schedule error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Advanced search for appointments/tokens
router.get('/search-appointments', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { searchTerm, dateFrom, dateTo, status, appointmentType, department } = req.query;
    const doctorId = req.doctor._id;

    // Build search query
    let query = { doctor_id: doctorId };

    // Text search in patient name, symptoms, or token number
    if (searchTerm) {
      const patients = await User.find({
        $or: [
          { name: { $regex: searchTerm, $options: 'i' } },
          { email: { $regex: searchTerm, $options: 'i' } }
        ]
      }).select('_id');

      const patientIds = patients.map(p => p._id);

      query.$or = [
        { patient_id: { $in: patientIds } },
        { symptoms: { $regex: searchTerm, $options: 'i' } },
        { token_number: { $regex: searchTerm, $options: 'i' } }
      ];
    }

    // Date range filter
    if (dateFrom || dateTo) {
      query.booking_date = {};
      if (dateFrom) query.booking_date.$gte = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        query.booking_date.$lte = endDate;
      }
    }

    // Status filter
    if (status) {
      query.status = status;
    }

    // Department filter
    if (department) {
      query.department = department;
    }

    const appointments = await Token.find(query)
      .populate('patient_id', 'name email phone')
      .sort({ booking_date: -1, createdAt: -1 })
      .limit(100);

    // Add patient name to results
    const results = appointments.map(apt => ({
      ...apt.toObject(),
      patient_name: apt.patient_id?.name || 'Unknown Patient'
    }));

    res.json({ appointments: results });
  } catch (error) {
    console.error('Search appointments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Export appointments to CSV
router.get('/export-appointments', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { searchTerm, dateFrom, dateTo, status, appointmentType, department } = req.query;
    const doctorId = req.doctor._id;

    // Use same query logic as search
    let query = { doctor_id: doctorId };

    if (searchTerm) {
      const patients = await User.find({
        $or: [
          { name: { $regex: searchTerm, $options: 'i' } },
          { email: { $regex: searchTerm, $options: 'i' } }
        ]
      }).select('_id');

      const patientIds = patients.map(p => p._id);

      query.$or = [
        { patient_id: { $in: patientIds } },
        { symptoms: { $regex: searchTerm, $options: 'i' } },
        { token_number: { $regex: searchTerm, $options: 'i' } }
      ];
    }

    if (dateFrom || dateTo) {
      query.booking_date = {};
      if (dateFrom) query.booking_date.$gte = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        query.booking_date.$lte = endDate;
      }
    }

    if (status) query.status = status;
    if (department) query.department = department;

    const appointments = await Token.find(query)
      .populate('patient_id', 'name email phone')
      .sort({ booking_date: -1 });

    // Generate CSV
    const csvHeader = 'Date,Time,Patient Name,Email,Phone,Department,Symptoms,Status,Token Number\n';
    const csvRows = appointments.map(apt => {
      const date = new Date(apt.booking_date).toLocaleDateString();
      const patientName = apt.patient_id?.name || 'Unknown';
      const email = apt.patient_id?.email || '';
      const phone = apt.patient_id?.phone || '';

      return `"${date}","${apt.time_slot}","${patientName}","${email}","${phone}","${apt.department}","${apt.symptoms}","${apt.status}","${apt.token_number || ''}"`;
    }).join('\n');

    const csvContent = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=appointments.csv');
    res.send(csvContent);
  } catch (error) {
    console.error('Export appointments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



// Get doctor's patients
router.get('/patients', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;

    // Get unique patients who have appointments with this doctor
    const appointments = await Token.find({ doctor_id: doctorId })
      .populate('patient_id', 'name email phone patient_info')
      .sort({ booking_date: -1 });

    // Create unique patients list with their latest appointment info
    const patientsMap = new Map();

    appointments.forEach(appointment => {
      const patientId = appointment.patient_id?._id?.toString();
      if (patientId && !patientsMap.has(patientId)) {
        const patient = appointment.patient_id;
        patientsMap.set(patientId, {
          id: patientId,
          name: patient.name,
          email: patient.email,
          phone: patient.phone,
          age: patient.patient_info?.age || 'N/A',
          gender: patient.patient_info?.gender || 'N/A',
          lastVisit: appointment.booking_date,
          condition: appointment.symptoms || 'N/A',
          status: appointment.status === 'consulted' ? 'Active' : 'Pending'
        });
      }
    });

    const patients = Array.from(patientsMap.values());
    res.json({ patients });
  } catch (error) {
    console.error('Get patients error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get booked patients (patients with active appointments)
router.get('/booked-patients', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;

    // Get patients who have active appointments (booked or in_queue status)
    const appointments = await Token.find({ 
      doctor_id: doctorId,
      status: { $in: ['booked', 'in_queue'] }
    })
      .populate('patient_id', 'name email phone patient_info')
      .sort({ booking_date: 1 });

    // Create unique patients list with their next appointment info
    const patientsMap = new Map();

    appointments.forEach(appointment => {
      const patientId = appointment.patient_id?._id?.toString();
      if (patientId) {
        const patient = appointment.patient_id;
        
        // If patient already exists, update with earliest appointment
        if (patientsMap.has(patientId)) {
          const existingPatient = patientsMap.get(patientId);
          if (new Date(appointment.booking_date) < new Date(existingPatient.nextAppointment.booking_date)) {
            existingPatient.nextAppointment = {
              booking_date: appointment.booking_date,
              time_slot: appointment.time_slot,
              status: appointment.status,
              token_number: appointment.token_number
            };
          }
        } else {
          // Add new patient
          patientsMap.set(patientId, {
            _id: patientId,
            name: patient.name,
            email: patient.email,
            phone: patient.phone,
            age: patient.patient_info?.age || 'N/A',
            gender: patient.patient_info?.gender || 'N/A',
            nextAppointment: {
              booking_date: appointment.booking_date,
              time_slot: appointment.time_slot,
              status: appointment.status,
              token_number: appointment.token_number
            }
          });
        }
      }
    });

    const patients = Array.from(patientsMap.values());
    res.json({ patients });
  } catch (error) {
    console.error('Get booked patients error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Set default working hours for doctor
router.post('/default-hours', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { workingHours, breakTime, slotDuration } = req.body;
    const doctorId = req.doctor._id;

    // Update doctor's default working hours in user profile
    await User.findByIdAndUpdate(doctorId, {
      $set: {
        'doctor_info.default_working_hours': workingHours,
        'doctor_info.default_break_time': breakTime,
        'doctor_info.default_slot_duration': slotDuration || 30
      }
    });

    res.json({
      message: 'Default working hours updated successfully',
      workingHours,
      breakTime,
      slotDuration: slotDuration || 30
    });
  } catch (error) {
    console.error('Set default hours error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get default working hours
router.get('/default-hours', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctor = await User.findById(req.doctor._id);
    
    res.json({
      workingHours: doctor.doctor_info?.default_working_hours || {
        start_time: '09:00',
        end_time: '17:00'
      },
      breakTime: doctor.doctor_info?.default_break_time || {
        start_time: '13:00',
        end_time: '14:00'
      },
      slotDuration: doctor.doctor_info?.default_slot_duration || 30
    });
  } catch (error) {
    console.error('Get default hours error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Bulk set schedule for multiple dates
router.post('/schedules/bulk', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, isAvailable, workingHours, breakTime, slotDuration, leaveReason, notes } = req.body;
    const doctorId = req.doctor._id;

    const start = new Date(startDate);
    const end = new Date(endDate);
    const schedules = [];
    const cancelledTokensCount = [];

    // Generate schedules for date range
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const scheduleDate = new Date(date);
      scheduleDate.setHours(0, 0, 0, 0);

      // Check if schedule already exists
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
          max_patients_per_slot: 1,
          leave_reason: leaveReason || '',
          notes: notes || ''
        });
        await schedule.save();
      }

      schedules.push(schedule);

      // If marking as unavailable, handle tokens
      if (!isAvailable) {
        const cancelledCount = await handleLeaveTokens(doctorId, scheduleDate);
        cancelledTokensCount.push({ date: scheduleDate, cancelledTokens: cancelledCount });
      }
    }

    res.json({
      message: 'Bulk schedule update completed successfully',
      schedulesUpdated: schedules.length,
      cancelledTokens: cancelledTokensCount
    });
  } catch (error) {
    console.error('Bulk schedule update error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get availability status for a specific date (used by booking system)
router.get('/availability/:date', authMiddleware, async (req, res) => {
  try {
    const { date } = req.params;
    const { doctorId } = req.query;

    if (!doctorId) {
      return res.status(400).json({ message: 'Doctor ID is required' });
    }

    const scheduleDate = new Date(date);
    scheduleDate.setHours(0, 0, 0, 0);

    const schedule = await DoctorSchedule.findOne({
      doctor_id: doctorId,
      date: scheduleDate
    });

    if (!schedule) {
      // No schedule set, doctor is not available
      res.json({
        isAvailable: false,
        workingHours: null,
        breakTime: null,
        slotDuration: null,
        leaveReason: 'No schedule'
      });
    } else {
      res.json({
        isAvailable: schedule.is_available,
        workingHours: schedule.working_hours,
        breakTime: schedule.break_time,
        slotDuration: schedule.slot_duration,
        leaveReason: schedule.leave_reason,
        notes: schedule.notes
      });
    }
  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get appointment trends for analytics
router.get('/analytics/trends', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;
    const { days = 30 } = req.query;

    const trends = await DoctorStatsService.getAppointmentTrends(doctorId, parseInt(days));
    
    res.json({ trends });
  } catch (error) {
    console.error('Get appointment trends error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient demographics
router.get('/analytics/demographics', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;
    
    const demographics = await DoctorStatsService.getPatientDemographics(doctorId);
    
    res.json({ demographics });
  } catch (error) {
    console.error('Get patient demographics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get comprehensive dashboard data in one call
router.get('/dashboard-data', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;
    const today = new Date().toISOString().split('T')[0];
    
    // Get all dashboard data in parallel
    const [
      stats,
      todayAppointments,
      recentSchedules,
      trends
    ] = await Promise.all([
      DoctorStatsService.getStats(doctorId),
      
      // Today's appointments
      Token.find({
        doctor_id: doctorId,
        booking_date: {
          $gte: new Date(today),
          $lt: new Date(new Date(today).getTime() + 24 * 60 * 60 * 1000)
        }
      })
      .populate('patient_id', 'name email phone')
      .sort({ time_slot: 1 })
      .limit(10),
      
      // Recent schedules (next 7 days)
      DoctorSchedule.find({
        doctor_id: doctorId,
        date: {
          $gte: new Date(today),
          $lte: new Date(new Date(today).getTime() + 7 * 24 * 60 * 60 * 1000)
        }
      }).sort({ date: 1 }),
      
      // 7-day trends
      DoctorStatsService.getAppointmentTrends(doctorId, 7)
    ]);

    res.json({
      stats: {
        todayAppointments: stats.today_appointments,
        pendingAppointments: stats.today_pending,
        completedAppointments: stats.total_completed,
        totalPatients: stats.total_patients,
        monthRevenue: stats.month_revenue,
        workingDaysThisMonth: stats.working_days_this_month,
        leaveDaysThisMonth: stats.leave_days_this_month
      },
      todayAppointments: todayAppointments.map(apt => ({
        _id: apt._id,
        patient_name: apt.patient_id?.name || 'Unknown Patient',
        patientName: apt.patient_id?.name || 'Unknown Patient',
        patientEmail: apt.patient_id?.email || '',
        patientPhone: apt.patient_id?.phone || '',
        booking_date: apt.booking_date,
        time_slot: apt.time_slot,
        status: apt.status,
        symptoms: apt.symptoms,
        token_number: apt.token_number,
        department: apt.department
      })),
      upcomingSchedules: recentSchedules.map(schedule => ({
        id: schedule._id,
        date: schedule.date,
        isAvailable: schedule.is_available,
        workingHours: schedule.working_hours,
        leaveReason: schedule.leave_reason
      })),
      weeklyTrends: trends
    });
  } catch (error) {
    console.error('Get dashboard data error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update doctor profile information
router.put('/profile', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;
    const { 
      specialization, 
      experience_years, 
      consultation_fee,
      phone,
      profile_photo,
      qualifications,
      certifications,
      license_number,
      bio,
      languages,
      consultation_type,
      slot_duration,
      qualification_proofs,
      certification_proofs
    } = req.body;

    const updateData = {};
    if (specialization) updateData['doctor_info.specialization'] = specialization;
    if (experience_years) updateData['doctor_info.experience_years'] = experience_years;
    if (consultation_fee) updateData['doctor_info.consultation_fee'] = consultation_fee;
    if (phone) updateData.phone = phone;
    if (profile_photo) updateData.profile_photo = profile_photo;
    if (qualifications) updateData['doctor_info.qualifications'] = qualifications;
    if (certifications) updateData['doctor_info.certifications'] = certifications;
    if (license_number) updateData['doctor_info.license_number'] = license_number;
    if (bio !== undefined) updateData['doctor_info.bio'] = String(bio || '');
    if (languages) updateData['doctor_info.languages'] = Array.isArray(languages) ? languages : String(languages).split(',').map(s=>s.trim()).filter(Boolean);
    if (consultation_type) updateData['doctor_info.consultation_type'] = consultation_type;
    if (slot_duration) updateData['doctor_info.default_slot_duration'] = parseInt(slot_duration) || 30;
    if (qualification_proofs) updateData['doctor_info.qualification_proofs'] = Array.isArray(qualification_proofs) ? qualification_proofs : [qualification_proofs];
    if (certification_proofs) updateData['doctor_info.certification_proofs'] = Array.isArray(certification_proofs) ? certification_proofs : [certification_proofs];

    let updatedDoctor = await User.findByIdAndUpdate(
      doctorId,
      { $set: updateData },
      { new: true }
    ).select('-password');

    // Auto-activate if profile was pending and mandatory fields are completed
    const mandatoryFilled = !!(updatedDoctor?.doctor_info?.license_number && updatedDoctor?.doctor_info?.qualifications && (updatedDoctor?.doctor_info?.bio || '').length >= 10);
    let profileCompleted = false;
    if (updatedDoctor?.status === 'pending' && mandatoryFilled) {
      updatedDoctor.status = 'active';
      await updatedDoctor.save();
      profileCompleted = true;
    }

    res.json({
      message: 'Profile updated successfully',
      doctor: updatedDoctor,
      profileCompleted
    });
  } catch (error) {
    console.error('Update doctor profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get doctor profile
router.get('/profile', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctor = await User.findById(req.doctor._id)
      .populate('doctor_info.department', 'name')
      .select('-password');

    res.json({ doctor });
  } catch (error) {
    console.error('Get doctor profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Batch update appointment statuses
router.patch('/appointments/batch-update', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { appointmentIds, status, notes } = req.body;
    const doctorId = req.doctor._id;

    if (!appointmentIds || !Array.isArray(appointmentIds) || appointmentIds.length === 0) {
      return res.status(400).json({ message: 'Appointment IDs are required' });
    }

    const validStatuses = ['booked', 'in_queue', 'consulted', 'cancelled', 'missed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const result = await Token.updateMany(
      {
        _id: { $in: appointmentIds },
        doctor_id: doctorId
      },
      { 
        status,
        ...(notes && { notes })
      }
    );

    res.json({
      message: `Updated ${result.modifiedCount} appointments successfully`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Batch update appointments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get dashboard statistics
router.get('/dashboard-stats', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);

    // Count today's appointments
    const todayAppointments = await Token.countDocuments({
      doctor_id: doctorId,
      booking_date: { $gte: today, $lt: tomorrow },
      status: { $nin: ['cancelled', 'missed'] }
    });

    // Count this week's appointments
    const weekAppointments = await Token.countDocuments({
      doctor_id: doctorId,
      booking_date: { $gte: weekStart, $lt: weekEnd },
      status: { $nin: ['cancelled', 'missed'] }
    });

    // Count this month's appointments
    const monthAppointments = await Token.countDocuments({
      doctor_id: doctorId,
      booking_date: { $gte: monthStart, $lte: monthEnd },
      status: { $nin: ['cancelled', 'missed'] }
    });

    // Count available days in next 30 days
    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + 30);

    const availableDays = await DoctorSchedule.countDocuments({
      doctor_id: doctorId,
      date: { $gte: today, $lte: futureDate },
      is_available: true
    });

    const stats = {
      todayAppointments,
      weekAppointments,
      monthAppointments,
      availableDays
    };

    res.json({ stats });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Submit schedule request (cancel or reschedule)
router.post('/schedule-requests', authMiddleware, async (req, res) => {
  try {
    console.log('📝 Schedule request received:', req.body);
    console.log('📝 User from token:', req.user);
    
    const { type, scheduleId, reason, date, newSchedule } = req.body;
    const doctorId = req.user.userId;

    console.log('📝 Doctor ID:', doctorId);
    console.log('📝 Request data:', { type, scheduleId, reason, date });

    if (!type || !scheduleId || !reason) {
      console.log('❌ Missing required fields:', { type, scheduleId, reason });
      return res.status(400).json({ 
        success: false, 
        message: 'Type, scheduleId, and reason are required' 
      });
    }

    // Generate unique request ID
    const requestId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    const scheduleRequest = {
      id: requestId,
      doctorId,
      type, // 'cancel' or 'reschedule'
      scheduleId,
      reason,
      date,
      newSchedule: newSchedule || null,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add to global schedule requests array (in production, this should be stored in database)
    global.scheduleRequests = global.scheduleRequests || [];
    global.scheduleRequests.push(scheduleRequest);

    console.log('✅ Schedule request created:', scheduleRequest);
    console.log('📊 Total requests now:', global.scheduleRequests.length);

    res.json({ 
      success: true, 
      message: 'Schedule request submitted successfully',
      requestId 
    });
  } catch (error) {
    console.error('Error submitting schedule request:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to submit schedule request' 
    });
  }
});

// Save consultation record
router.patch('/appointments/:appointmentId/consultation', authMiddleware, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { consultationData, status } = req.body;
    const doctorId = req.user.userId;

    // Find the appointment
    const appointment = await Token.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Check if doctor is authorized for this appointment
    if (appointment.doctor_id.toString() !== doctorId) {
      return res.status(403).json({ message: 'Unauthorized to access this appointment' });
    }

    // Update appointment status
    if (status) {
      appointment.status = status;
      appointment.consultation_completed_at = new Date();
    }

    // Save consultation data to appointment
    appointment.consultationData = consultationData;
    await appointment.save();

    // Create or update consultation record
    let consultationRecord = await ConsultationRecord.findOne({ appointment_id: appointmentId });
    
    if (consultationRecord) {
      // Update existing record
      consultationRecord.consultationData = consultationData;
      consultationRecord.status = status === 'consulted' ? 'completed' : 'draft';
      consultationRecord.updated_at = new Date();
      await consultationRecord.save();
    } else {
      // Create new record
      consultationRecord = new ConsultationRecord({
        appointment_id: appointmentId,
        doctor_id: doctorId,
        patient_id: appointment.patient_id,
        consultationData: consultationData,
        status: status === 'consulted' ? 'completed' : 'draft',
        consultation_date: new Date()
      });
      await consultationRecord.save();
    }

    console.log('✅ Consultation record saved:', {
      appointmentId,
      doctorId,
      status: consultationRecord.status,
      hasData: !!consultationData
    });

    res.json({
      success: true,
      message: 'Consultation record saved successfully',
      consultationRecord: {
        id: consultationRecord._id,
        status: consultationRecord.status,
        consultation_date: consultationRecord.consultation_date
      }
    });

  } catch (error) {
    console.error('Error saving consultation record:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to save consultation record' 
    });
  }
});

// Get consultation record
router.get('/appointments/:appointmentId/consultation', authMiddleware, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const doctorId = req.user.userId;

    // Find the appointment
    const appointment = await Token.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Check if doctor is authorized for this appointment
    if (appointment.doctor_id.toString() !== doctorId) {
      return res.status(403).json({ message: 'Unauthorized to access this appointment' });
    }

    // Find consultation record
    const consultationRecord = await ConsultationRecord.findOne({ appointment_id: appointmentId });

    res.json({
      success: true,
      consultationRecord: consultationRecord || null,
      appointmentData: {
        consultationData: appointment.consultationData || null,
        status: appointment.status
      }
    });

  } catch (error) {
    console.error('Error fetching consultation record:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch consultation record' 
    });
  }
});

// Upload doctor profile photo
router.post('/upload-photo', authMiddleware, doctorMiddleware, profilePhotoUpload.single('profilePhoto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No photo uploaded' });
    }

    // Get current doctor to check for existing photo
    const doctor = await User.findById(req.doctor._id);
    
    // Delete old photo from Cloudinary if exists
    if (doctor.profile_photo && doctor.profile_photo.includes('cloudinary.com')) {
      const publicId = CloudinaryService.extractPublicId(doctor.profile_photo);
      if (publicId) {
        await CloudinaryService.deleteImage(publicId);
      }
    }
    
    // Upload new photo to Cloudinary
    const tempFilePath = path.join(__dirname, '../../temp', `temp-${Date.now()}-${req.file.originalname}`);
    
    // Ensure temp directory exists
    const tempDir = path.dirname(tempFilePath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Write buffer to temporary file
    fs.writeFileSync(tempFilePath, req.file.buffer);
    
    // Upload to Cloudinary
    const publicId = `doctor-profile-${req.doctor._id}-${Date.now()}`;
    const uploadResult = await CloudinaryService.uploadImage(tempFilePath, 'opd-profiles', publicId);
    
    if (!uploadResult.success) {
      return res.status(500).json({ message: 'Failed to upload photo to cloud storage' });
    }
    
    // Update doctor with new photo URL
    await User.findByIdAndUpdate(req.doctor._id, {
      $set: { 
        profile_photo: uploadResult.url,
        profileImage: uploadResult.url // Also set profileImage for compatibility
      }
    });

    res.json({ 
      message: 'Photo uploaded successfully', 
      photoUrl: uploadResult.url 
    });
  } catch (error) {
    console.error('Upload photo error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove doctor profile photo
router.delete('/remove-photo', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctor = await User.findById(req.doctor._id);
    
    if (doctor.profile_photo) {
      // Delete from Cloudinary if it's a Cloudinary URL
      if (doctor.profile_photo.includes('cloudinary.com')) {
        const publicId = CloudinaryService.extractPublicId(doctor.profile_photo);
        if (publicId) {
          await CloudinaryService.deleteImage(publicId);
        }
      } else {
        // Remove old local file if it exists
        const photoPath = path.join(__dirname, '../../', doctor.profile_photo);
        if (fs.existsSync(photoPath)) {
          fs.unlinkSync(photoPath);
        }
      }
      
      // Remove photo reference from database
      await User.findByIdAndUpdate(req.doctor._id, {
        $unset: { 
          profile_photo: 1,
          profileImage: 1 
        }
      });
    }

    res.json({ message: 'Photo removed successfully' });
  } catch (error) {
    console.error('Remove photo error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
