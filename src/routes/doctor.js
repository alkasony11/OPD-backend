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
const notificationService = require('../services/notificationService');
const RealtimeSyncService = require('../services/realtimeSyncService');
const Notification = require('../models/Notification');
const emailService = require('../services/emailService');

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
    console.log('🔍 Doctor middleware - req.path:', req.path);
    console.log('🔍 Doctor middleware - req.method:', req.method);
    
    if (!req.user || !req.user.userId) {
      console.log('❌ Doctor middleware - No user or userId');
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    const user = await User.findById(req.user.userId);
    console.log('🔍 Doctor middleware - found user:', user);
    
    if (!user) {
      console.log('❌ Doctor middleware - User not found in database');
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log('🔍 Doctor middleware - User role:', user.role);
    if (user.role !== 'doctor') {
      console.log('❌ Doctor middleware - User role is not doctor:', user.role);
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
    } else if (filter === 'referred') {
      // For 'referred' filter, show referred appointments
      query.status = 'referred';
    } else if (filter === 'all') {
      // For 'all' filter, exclude only cancelled and missed appointments
      query.status = { $nin: ['cancelled', 'missed'] };
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
      doctorNotes: apt.doctorNotes || '', // Include doctor notes if available
      diagnosis: apt.diagnosis || '', // Include diagnosis if available
      token_number: apt.token_number,
      tokenNumber: apt.token_number,
      department: apt.department,
      payment_status: apt.payment_status,
      paymentStatus: apt.payment_status,
      estimated_wait_time: apt.estimated_wait_time,
      estimatedWaitTime: apt.estimated_wait_time,
      // Surface meeting link for video consultations
      meeting_link: apt.meeting_link || null,
      // Include consultation data for completed appointments
      consultationData: apt.consultationData || null,
      consultation_completed_at: apt.consultation_completed_at || null
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

    // Emit real-time appointment update event (non-blocking)
    try {
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
    } catch (realtimeError) {
      console.warn('Realtime sync error (non-critical):', realtimeError);
      // Don't fail the request if realtime sync fails
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
router.patch('/appointments/:appointmentId/consultation', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { consultationData, status } = req.body;
    const doctorId = req.doctor._id;
    
    console.log('🔍 Save consultation - Request received:', {
      appointmentId,
      doctorId,
      hasConsultationData: !!consultationData,
      consultationDataKeys: consultationData ? Object.keys(consultationData) : [],
      medications: consultationData?.medications,
      hasMedications: !!consultationData?.medications,
      medicationsLength: consultationData?.medications?.length,
      status,
      userRole: req.user?.role
    });

    // Find the appointment
    const appointment = await Token.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    console.log('🔍 Save consultation - Found appointment:', {
      appointmentId,
      appointmentDoctorId: appointment.doctor_id.toString(),
      requestDoctorId: doctorId.toString(),
      match: appointment.doctor_id.toString() === doctorId.toString()
    });

    // Check if doctor is authorized for this appointment
    if (appointment.doctor_id.toString() !== doctorId.toString()) {
      console.log('❌ Save consultation - Unauthorized access attempt');
      return res.status(403).json({ message: 'Unauthorized to access this appointment' });
    }

    // Update appointment status
    if (status) {
      console.log('🔍 Save consultation - Updating status:', { oldStatus: appointment.status, newStatus: status });
      appointment.status = status;
      appointment.consultation_completed_at = new Date();
    }

    // Save consultation data to appointment
    console.log('🔍 Save consultation - Saving consultation data:', consultationData);
    appointment.consultationData = consultationData;
    await appointment.save();
    console.log('✅ Save consultation - Appointment saved successfully');
    
    // Verify what was actually saved
    const savedAppointment = await Token.findById(appointmentId);
    console.log('🔍 Save consultation - Verification - Saved consultationData:', {
      hasConsultationData: !!savedAppointment.consultationData,
      consultationDataKeys: savedAppointment.consultationData ? Object.keys(savedAppointment.consultationData) : [],
      medications: savedAppointment.consultationData?.medications,
      hasMedications: !!savedAppointment.consultationData?.medications,
      medicationsLength: savedAppointment.consultationData?.medications?.length
    });

    // Create or update consultation record
    console.log('🔍 Save consultation - Looking for existing consultation record...');
    let consultationRecord = await ConsultationRecord.findOne({ appointment_id: appointmentId });
    
    if (consultationRecord) {
      console.log('🔍 Save consultation - Updating existing consultation record');
      // Update existing record
      consultationRecord.consultationData = consultationData;
      consultationRecord.status = status === 'consulted' ? 'completed' : 'draft';
      consultationRecord.updated_at = new Date();
      await consultationRecord.save();
      console.log('✅ Save consultation - Consultation record updated');
    } else {
      console.log('🔍 Save consultation - Creating new consultation record');
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
      console.log('✅ Save consultation - New consultation record created');
    }

    console.log('✅ Consultation record saved:', {
      appointmentId,
      doctorId,
      status: consultationRecord.status,
      hasData: !!consultationData
    });

    const response = {
      success: true,
      message: 'Consultation record saved successfully',
      consultationRecord: {
        id: consultationRecord._id,
        status: consultationRecord.status,
        consultation_date: consultationRecord.consultation_date
      }
    };

    console.log('🔍 Save consultation - Sending response:', response);
    res.json(response);

  } catch (error) {
    console.error('❌ Error saving consultation record:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to save consultation record',
      error: error.message
    });
  }
});

// Get consultation record
router.get('/appointments/:appointmentId/consultation', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const doctorId = req.doctor._id;

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

// Get doctor's medical records (consultation records)
router.get('/medical-records', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const doctorId = req.doctor._id;
    const { status, page = 1, limit = 10 } = req.query;
    
    console.log('🔍 Fetching medical records for doctor:', doctorId);
    
    // Build query
    const query = { doctor_id: doctorId };
    if (status && status !== 'all') {
      query.status = status;
    }
    
    // First try to get consultation records
    let consultationRecords = await ConsultationRecord.find(query)
      .populate('patient_id', 'name email phone')
      .populate('appointment_id', 'booking_date time_slot status')
      .sort({ consultation_date: -1 })
      .limit(parseInt(limit) * 1)
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    let totalRecords = await ConsultationRecord.countDocuments(query);
    
    // If no consultation records found, fallback to completed appointments with consultation data
    if (consultationRecords.length === 0) {
      console.log('🔍 No consultation records found, checking completed appointments...');
      
      const appointmentQuery = { 
        doctor_id: doctorId, 
        status: 'consulted',
        consultationData: { $exists: true, $ne: null }
      };
      
      const completedAppointments = await Token.find(appointmentQuery)
        .populate('patient_id', 'name email phone')
        .sort({ consultation_completed_at: -1 })
        .limit(parseInt(limit) * 1)
        .skip((parseInt(page) - 1) * parseInt(limit));
      
      // Transform appointments to match consultation record format
      consultationRecords = completedAppointments.map(appointment => ({
        _id: appointment._id,
        patient_id: appointment.patient_id,
        appointment_id: appointment,
        consultationData: appointment.consultationData,
        status: 'completed',
        consultation_date: appointment.consultation_completed_at || appointment.updatedAt,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt
      }));
      
      totalRecords = await Token.countDocuments(appointmentQuery);
    }
    
    // Transform data for frontend
    const records = consultationRecords.map(record => ({
      id: record._id,
      patient_name: record.patient_id?.name || 'Unknown Patient',
      patient_email: record.patient_id?.email || '',
      patient_phone: record.patient_id?.phone || '',
      appointment_date: record.appointment_id?.booking_date || record.consultation_date,
      appointment_time: record.appointment_id?.time_slot || '',
      status: record.status,
      diagnosis: record.consultationData?.diagnosis || '',
      chief_complaint: record.consultationData?.chiefComplaint || '',
      history_of_present_illness: record.consultationData?.historyOfPresentIllness || '',
      physical_examination: record.consultationData?.physicalExamination || '',
      vital_signs: record.consultationData?.vitalSigns || {},
      medications: record.consultationData?.medications || [],
      notes: record.consultationData?.notes || '',
      follow_up_required: record.consultationData?.followUpRequired || false,
      follow_up_date: record.consultationData?.followUpDate || null,
      created_at: record.createdAt,
      updated_at: record.updatedAt
    }));
    
    console.log('✅ Found', records.length, 'medical records');
    
    res.json({
      success: true,
      records,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalRecords / parseInt(limit)),
        totalRecords,
        hasNextPage: parseInt(page) < Math.ceil(totalRecords / parseInt(limit)),
        hasPrevPage: parseInt(page) > 1
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching medical records:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch medical records',
      error: error.message
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
      // Clean up temp file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      
      return res.status(500).json({ 
        message: uploadResult.error || 'Failed to upload photo to cloud storage',
        error: uploadResult.error
      });
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
          profileImage: 1 // Also remove profileImage for compatibility
        }
      });
    }

    res.json({ message: 'Photo removed successfully' });
  } catch (error) {
    console.error('Remove photo error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Doctor joins video consultation
router.post('/join-video-consultation/:appointmentId', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const doctorId = req.doctor._id;

    // Find the appointment
    const appointment = await Token.findById(appointmentId)
      .populate('patient_id', 'name email phone')
      .populate('family_member_id', 'name');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Verify this appointment belongs to the doctor
    if (appointment.doctor_id.toString() !== doctorId.toString()) {
      return res.status(403).json({ message: 'Unauthorized: This appointment does not belong to you' });
    }

    // Check if it's a video consultation
    if (appointment.appointment_type !== 'video') {
      return res.status(400).json({ message: 'This is not a video consultation appointment' });
    }

    // Check if meeting link exists
    if (!appointment.meeting_link || !appointment.meeting_link.meetingUrl) {
      return res.status(400).json({ message: 'Meeting link not found for this appointment' });
    }

    // Check if doctor has already joined
    if (appointment.meeting_link.doctorJoined) {
      return res.status(400).json({ message: 'You have already joined this meeting' });
    }

    // Update appointment to mark doctor as joined
    const updatedAppointment = await Token.findByIdAndUpdate(
      appointmentId,
      {
        $set: {
          'meeting_link.doctorJoined': true,
          'meeting_link.doctorJoinedAt': new Date()
        }
      },
      { new: true }
    ).populate('patient_id', 'name email phone')
     .populate('family_member_id', 'name');

    // Get patient details
    const patientName = appointment.family_member_id ? 
      appointment.family_member_id.name : 
      appointment.patient_id.name;
    
    const patientEmail = appointment.patient_id.email;
    const patientPhone = appointment.patient_id.phone;

    // Create professional notification for patient
    try {
      await notificationService.createNotification({
        recipient_id: appointment.patient_id._id,
        recipient_type: 'patient',
        title: 'Doctor Ready for Video Consultation',
        message: `Dr. ${req.doctor.name} has joined the video consultation room and is ready to see you. Please join the meeting now.`,
        type: 'video_consultation',
        priority: 'high',
        related_id: appointment._id,
        related_type: 'appointment',
        metadata: {
          doctorName: req.doctor.name,
          appointmentDate: appointment.booking_date,
          appointmentTime: appointment.time_slot,
          meetingUrl: appointment.meeting_link.meetingUrl,
          patientName
        }
      });
    } catch (notificationError) {
      console.error('Error creating patient notification:', notificationError);
    }

    // Send email notification to patient
    if (patientEmail) {
      try {
        const appointmentDate = new Date(appointment.booking_date).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        const appointmentTime = appointment.time_slot;

        const subject = `Doctor Ready - Video Consultation with Dr. ${req.doctor.name}`;
        const htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Doctor Ready for Video Consultation</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              .alert-box { background: #ecfdf5; border: 2px solid #10b981; padding: 20px; border-radius: 8px; margin: 20px 0; }
              .meeting-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              .join-button { display: inline-block; background: #10b981; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
              .join-button:hover { background: #059669; }
              .instructions { background: #f0f9ff; padding: 15px; border-left: 4px solid #0ea5e9; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>🏥 MediQ Hospital</h1>
              <h2>Doctor Ready for Video Consultation</h2>
            </div>
            
            <div class="content">
              <p>Dear <strong>${patientName}</strong>,</p>
              
              <div class="alert-box">
                <h3>✅ Great News!</h3>
                <p><strong>Dr. ${req.doctor.name}</strong> has joined the video consultation room and is ready to see you.</p>
              </div>
              
              <div class="meeting-details">
                <h3>📅 Consultation Details</h3>
                <p><strong>Date:</strong> ${appointmentDate}</p>
                <p><strong>Time:</strong> ${appointmentTime}</p>
                <p><strong>Doctor:</strong> Dr. ${req.doctor.name}</p>
                <p><strong>Department:</strong> ${appointment.department}</p>
              </div>
              
              <div style="text-align: center;">
                <a href="${appointment.meeting_link.meetingUrl}" class="join-button" target="_blank">
                  🎥 Join Video Consultation Now
                </a>
              </div>
              
              <div class="instructions">
                <h4>📋 Quick Instructions:</h4>
                <ul>
                  <li>Click the "Join Video Consultation Now" button above</li>
                  <li>Allow camera and microphone permissions when prompted</li>
                  <li>Ensure you have a stable internet connection</li>
                  <li>Find a quiet, well-lit space for the consultation</li>
                  <li>Have your ID and any medical documents ready</li>
                </ul>
              </div>
              
              <p><strong>Meeting ID:</strong> ${appointment.meeting_link.meetingId}</p>
              ${appointment.meeting_link.meetingPassword ? `<p><strong>Password:</strong> ${appointment.meeting_link.meetingPassword}</p>` : ''}
              
              <p>If you experience any technical difficulties, please contact our support team immediately.</p>
              
              <p>Thank you for choosing MediQ Hospital!</p>
            </div>
          </body>
          </html>
        `;

        const mailOptions = {
          from: `"MediQ Hospital" <${process.env.EMAIL_USER}>`,
          to: patientEmail,
          subject: subject,
          html: htmlContent
        };

        const { transporter } = require('../config/email');
        await transporter.sendMail(mailOptions);
        console.log('📧 Doctor join notification email sent to patient');
      } catch (emailError) {
        console.error('Error sending email notification:', emailError);
      }
    }

    // Send real-time notification to patient
    try {
      const realtimeService = global.realtimeSyncService;
      if (realtimeService) {
        await realtimeService.emitAppointmentUpdate(doctorId, {
          appointmentId: appointment._id,
          type: 'doctor_joined_video',
          message: `Dr. ${req.doctor.name} has joined the video consultation`,
          meetingUrl: appointment.meeting_link.meetingUrl,
          patientId: appointment.patient_id._id
        });
      }
    } catch (realtimeError) {
      console.error('Error sending real-time notification:', realtimeError);
    }

    res.json({
      message: 'Successfully joined video consultation',
      appointment: {
        id: updatedAppointment._id,
        patientName,
        appointmentDate: appointment.booking_date,
        appointmentTime: appointment.time_slot,
        meetingUrl: appointment.meeting_link.meetingUrl,
        doctorJoined: true,
        doctorJoinedAt: updatedAppointment.meeting_link.doctorJoinedAt
      }
    });

  } catch (error) {
    console.error('Join video consultation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Doctor closes video consultation
router.post('/close-video-consultation/:appointmentId', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const doctorId = req.doctor._id;
    
    console.log('🔍 Close video consultation - Request received:', { appointmentId, doctorId });

    // Find the appointment
    const appointment = await Token.findById(appointmentId)
      .populate('patient_id', 'name email phone')
      .populate('family_member_id', 'name');

    console.log('🔍 Close video consultation - Found appointment:', appointment ? 'Yes' : 'No');
    
    if (!appointment) {
      console.log('🔍 Close video consultation - Appointment not found');
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Verify this appointment belongs to the doctor
    console.log('🔍 Close video consultation - Checking doctor ownership:', { 
      appointmentDoctorId: appointment.doctor_id.toString(), 
      requestDoctorId: doctorId.toString() 
    });
    
    if (appointment.doctor_id.toString() !== doctorId.toString()) {
      console.log('🔍 Close video consultation - Unauthorized access attempt');
      return res.status(403).json({ message: 'Unauthorized: This appointment does not belong to you' });
    }

    // Check if it's a video consultation
    console.log('🔍 Close video consultation - Appointment type:', appointment.appointment_type);
    if (appointment.appointment_type !== 'video') {
      console.log('🔍 Close video consultation - Not a video consultation');
      return res.status(400).json({ message: 'This is not a video consultation appointment' });
    }

    // Check if doctor has joined the meeting
    console.log('🔍 Close video consultation - Doctor joined status:', appointment.meeting_link?.doctorJoined);
    if (!appointment.meeting_link?.doctorJoined) {
      console.log('🔍 Close video consultation - Doctor has not joined yet');
      return res.status(400).json({ message: 'You have not joined this meeting yet' });
    }

    // Update the appointment to mark doctor as left and consultation as completed
    console.log('🔍 Close video consultation - Updating appointment status to consulted');
    const updatedAppointment = await Token.findByIdAndUpdate(
      appointmentId,
      {
        $set: {
          'meeting_link.doctorJoined': false,
          'meeting_link.doctorLeftAt': new Date(),
          'meeting_link.meetingEnded': true,
          'meeting_link.meetingEndedAt': new Date(),
          status: 'consulted',
          consultation_completed_at: new Date()
        }
      },
      { new: true }
    );
    
    console.log('✅ Close video consultation - Appointment updated:', {
      appointmentId,
      newStatus: updatedAppointment.status,
      consultationCompletedAt: updatedAppointment.consultation_completed_at
    });

    // Get patient information for notification
    const patientName = appointment.family_member_id?.name || appointment.patient_id?.name || 'Patient';
    const patientEmail = appointment.patient_id?.email;

    // Create notification for patient
    try {
      await Notification.create({
        recipient_id: appointment.patient_id._id,
        recipient_type: 'patient',
        title: 'Video Consultation Ended',
        message: `Dr. ${req.doctor.name} has ended the video consultation. The meeting has been closed.`,
        type: 'video_consultation_ended',
        priority: 'medium',
        related_id: appointment._id,
        related_type: 'appointment',
        metadata: {
          doctorName: req.doctor.name,
          appointmentDate: appointment.booking_date,
          appointmentTime: appointment.time_slot,
          patientName
        }
      });
    } catch (notificationError) {
      console.error('Error creating patient notification:', notificationError);
    }

    // Send email notification to patient
    if (patientEmail) {
      try {
        const appointmentDate = new Date(appointment.booking_date).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        const appointmentTime = appointment.time_slot || '09:00';

        await emailService.sendEmail({
          to: patientEmail,
          subject: 'Video Consultation Ended - MediQ',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 24px;">Video Consultation Ended</h1>
                <p style="margin: 10px 0 0 0; opacity: 0.9;">Your consultation with Dr. ${req.doctor.name} has been completed</p>
              </div>
              
              <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="text-align: center; margin-bottom: 30px;">
                  <div style="width: 80px; height: 80px; background: #f3f4f6; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                    <span style="font-size: 32px;">✅</span>
                  </div>
                  <h2 style="color: #1f2937; margin: 0 0 10px 0;">Consultation Completed</h2>
                  <p style="color: #6b7280; margin: 0;"><strong>Dr. ${req.doctor.name}</strong> has ended the video consultation.</p>
                </div>
                
                <div class="meeting-details" style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                  <h3 style="color: #1f2937; margin: 0 0 15px 0;">📅 Consultation Details</h3>
                  <p style="margin: 5px 0; color: #374151;"><strong>Date:</strong> ${appointmentDate}</p>
                  <p style="margin: 5px 0; color: #374151;"><strong>Time:</strong> ${appointmentTime}</p>
                  <p style="margin: 5px 0; color: #374151;"><strong>Doctor:</strong> Dr. ${req.doctor.name}</p>
                  <p style="margin: 5px 0; color: #374151;"><strong>Department:</strong> ${appointment.department}</p>
                </div>
                
                <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                  <h4 style="color: #92400e; margin: 0 0 10px 0;">📋 Next Steps</h4>
                  <ul style="color: #92400e; margin: 0; padding-left: 20px;">
                    <li>Check your email for any prescriptions or medical records</li>
                    <li>Contact the clinic if you have any follow-up questions</li>
                    <li>Schedule a follow-up appointment if recommended by your doctor</li>
                  </ul>
                </div>
                
                <div style="text-align: center; margin-top: 30px;">
                  <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/appointments" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500;">
                    View Your Appointments
                  </a>
                </div>
              </div>
              
              <div style="text-align: center; margin-top: 20px; color: #6b7280; font-size: 14px;">
                <p>Thank you for using MediQ for your healthcare needs.</p>
                <p>If you have any questions, please contact our support team.</p>
              </div>
            </div>
          `
        });
      } catch (emailError) {
        console.error('Error sending email notification:', emailError);
      }
    }

    // Send real-time notification to patient
    try {
      const realtimeSyncService = require('../services/realtimeSyncService');
      if (realtimeSyncService && global.io) {
        const realtimeService = new realtimeSyncService(global.io);
        realtimeService.emitAppointmentUpdate(appointment.doctor_id, {
          type: 'doctor_left_video',
          message: `Dr. ${req.doctor.name} has ended the video consultation`,
          appointmentId: appointment._id,
          patientId: appointment.patient_id._id
        });
      }
    } catch (realtimeError) {
      console.error('Error sending real-time notification:', realtimeError);
    }

    res.json({
      message: 'Successfully closed video consultation',
      appointment: {
        id: updatedAppointment._id,
        patientName,
        appointmentDate: appointment.booking_date,
        appointmentTime: appointment.time_slot,
        doctorLeft: true,
        doctorLeftAt: updatedAppointment.meeting_link.doctorLeftAt,
        meetingEnded: true,
        meetingEndedAt: updatedAppointment.meeting_link.meetingEndedAt
      }
    });

  } catch (error) {
    console.error('Close video consultation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
