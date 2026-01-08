const express = require('express');
const router = express.Router();
const { User, Token, Appointment } = require('../models/User');
const Department = require('../models/Department');
const DoctorSchedule = require('../models/DoctorSchedule');
const { authMiddleware } = require('../middleware/authMiddleware');
const { getSessionInfo, parseTime, generateSequentialTokenNumber } = require('../utils/bookingUtils');

// Helper function to calculate sequential time slot based on token number
function calculateSequentialTimeSlot(tokenNumber, sessionType, slotDuration) {
  // Extract the numeric part from token number (e.g., T001 -> 1, T002 -> 2)
  const tokenNum = parseInt(tokenNumber.replace('T', ''));
  
  // Define session start times
  let sessionStartTime;
  switch (sessionType) {
    case 'morning':
      sessionStartTime = '09:00';
      break;
    case 'afternoon':
      sessionStartTime = '14:00';
      break;
    case 'evening':
      sessionStartTime = '18:00';
      break;
    default:
      sessionStartTime = '09:00';
  }
  
  // Calculate the time slot based on token number and slot duration
  // Token 1 = session start time, Token 2 = session start + slot duration, etc.
  const totalMinutes = (tokenNum - 1) * slotDuration;
  
  // Parse session start time
  const [startHours, startMinutes] = sessionStartTime.split(':').map(Number);
  const startTimeInMinutes = startHours * 60 + startMinutes;
  
  // Calculate the actual time
  const actualTimeInMinutes = startTimeInMinutes + totalMinutes;
  
  // Convert back to HH:MM format
  const hours = Math.floor(actualTimeInMinutes / 60);
  const minutes = actualTimeInMinutes % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

// Middleware to check if user is a receptionist
const receptionistMiddleware = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || user.role !== 'receptionist') {
      return res.status(403).json({ message: 'Access denied. Receptionist role required.' });
    }
    req.receptionist = user;
    next();
  } catch (error) {
    console.error('Receptionist middleware error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get all appointments for today (receptionist view)
router.get('/appointments/today', authMiddleware, receptionistMiddleware, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const appointments = await Token.find({
      booking_date: { $gte: today, $lt: tomorrow },
      status: { $nin: ['cancelled', 'missed'] }
    })
    .populate('patient_id', 'name email phone')
    .populate('doctor_id', 'name doctor_info')
    .populate('family_member_id', 'name age relation')
    .sort({ time_slot: 1 });

    const formattedAppointments = appointments.map(apt => ({
      _id: apt._id,
      tokenNumber: apt.token_number,
      patientName: apt.family_member_id ? apt.family_member_id.name : apt.patient_id.name,
      patientEmail: apt.patient_id.email,
      patientPhone: apt.patient_id.phone,
      doctorName: apt.doctor_id.name,
      department: apt.department,
      appointmentDate: apt.booking_date,
      timeSlot: apt.time_slot,
      status: apt.status,
      symptoms: apt.symptoms,
      estimatedWaitTime: apt.estimated_wait_time,
      paymentStatus: apt.payment_status,
      isFamilyMember: !!apt.family_member_id,
      familyMemberInfo: apt.family_member_id
    }));

    res.json({ appointments: formattedAppointments });
  } catch (error) {
    console.error('Get today appointments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all appointments with filters
router.get('/appointments', authMiddleware, receptionistMiddleware, async (req, res) => {
  try {
    const { 
      date, 
      doctorId, 
      department, 
      status, 
      page = 1, 
      limit = 20,
      search 
    } = req.query;

    let query = {};

    // Date filter
    if (date) {
      const selectedDate = new Date(date);
      selectedDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(selectedDate);
      nextDay.setDate(nextDay.getDate() + 1);
      query.booking_date = { $gte: selectedDate, $lt: nextDay };
    }

    // Doctor filter
    if (doctorId) {
      query.doctor_id = doctorId;
    }

    // Department filter
    if (department) {
      query.department = department;
    }

    // Status filter
    if (status) {
      query.status = status;
    }

    // Search filter
    if (search) {
      query.$or = [
        { token_number: { $regex: search, $options: 'i' } },
        { symptoms: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;

    const appointments = await Token.find(query)
      .populate('patient_id', 'name email phone')
      .populate('doctor_id', 'name doctor_info')
      .populate('family_member_id', 'name age relation')
      .sort({ booking_date: -1, time_slot: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Token.countDocuments(query);

    const formattedAppointments = appointments.map(apt => ({
      _id: apt._id,
      tokenNumber: apt.token_number,
      patientName: apt.family_member_id ? apt.family_member_id.name : apt.patient_id.name,
      patientEmail: apt.patient_id.email,
      patientPhone: apt.patient_id.phone,
      doctorName: apt.doctor_id.name,
      department: apt.department,
      appointmentDate: apt.booking_date,
      timeSlot: apt.time_slot,
      status: apt.status,
      symptoms: apt.symptoms,
      estimatedWaitTime: apt.estimated_wait_time,
      paymentStatus: apt.payment_status,
      isFamilyMember: !!apt.family_member_id,
      familyMemberInfo: apt.family_member_id
    }));

    res.json({ 
      appointments: formattedAppointments,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update appointment status
router.patch('/appointments/:id/status', authMiddleware, receptionistMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({ message: 'Status is required' });
    }

    const validStatuses = ['booked', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const appointment = await Token.findByIdAndUpdate(
      id,
      { 
        status,
        ...(notes && { receptionist_notes: notes }),
        updated_at: new Date()
      },
      { new: true }
    )
    .populate('patient_id', 'name email phone')
    .populate('doctor_id', 'name')
    .populate('family_member_id', 'name age relation');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    res.json({ 
      message: 'Appointment status updated successfully',
      appointment: {
        _id: appointment._id,
        tokenNumber: appointment.token_number,
        patientName: appointment.family_member_id ? appointment.family_member_id.name : appointment.patient_id.name,
        doctorName: appointment.doctor_id.name,
        status: appointment.status,
        timeSlot: appointment.time_slot
      }
    });
  } catch (error) {
    console.error('Update appointment status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reschedule appointment
router.patch('/appointments/:id/reschedule', authMiddleware, receptionistMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { newDate, newTime, reason } = req.body;

    if (!newDate || !newTime) {
      return res.status(400).json({ message: 'New date and time are required' });
    }

    const appointment = await Token.findById(id)
      .populate('doctor_id', 'name doctor_info');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    const selectedDate = new Date(newDate);
    selectedDate.setHours(0, 0, 0, 0);

    // Check if doctor is available on new date
    const schedule = await DoctorSchedule.findOne({
      doctor_id: appointment.doctor_id._id,
      date: selectedDate
    });

    if (!schedule || !schedule.is_available) {
      return res.status(400).json({ 
        message: `Doctor is not available on ${newDate}` 
      });
    }

    // Check if new time slot is available
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const existingAppointment = await Token.findOne({
      doctor_id: appointment.doctor_id._id,
      booking_date: { $gte: selectedDate, $lt: nextDay },
      time_slot: newTime,
      status: { $nin: ['cancelled', 'missed'] },
      _id: { $ne: id }
    });

    if (existingAppointment) {
      return res.status(400).json({ 
        message: 'Time slot is already booked' 
      });
    }

    // Update appointment
    const updatedAppointment = await Token.findByIdAndUpdate(
      id,
      { 
        booking_date: selectedDate,
        time_slot: newTime,
        reschedule_reason: reason,
        rescheduled_by: 'receptionist',
        rescheduled_at: new Date(),
        updated_at: new Date()
      },
      { new: true }
    )
    .populate('patient_id', 'name email phone')
    .populate('doctor_id', 'name')
    .populate('family_member_id', 'name age relation');

    // Send WhatsApp rescheduling confirmation
    const whatsappBotService = require('../services/whatsappBotService');
    const oldDate = new Date(appointment.booking_date).toLocaleDateString();
    const oldTime = appointment.time_slot;
    whatsappBotService.sendReschedulingConfirmation(updatedAppointment._id, oldDate, oldTime).then(() => {
      console.log('✅ WhatsApp rescheduling confirmation sent successfully');
    }).catch((error) => {
      console.error('❌ Error sending WhatsApp rescheduling confirmation:', error);
    });

    res.json({ 
      message: 'Appointment rescheduled successfully',
      appointment: {
        _id: updatedAppointment._id,
        tokenNumber: updatedAppointment.token_number,
        patientName: updatedAppointment.family_member_id ? updatedAppointment.family_member_id.name : updatedAppointment.patient_id.name,
        doctorName: updatedAppointment.doctor_id.name,
        appointmentDate: updatedAppointment.booking_date,
        timeSlot: updatedAppointment.time_slot,
        status: updatedAppointment.status
      }
    });
  } catch (error) {
    console.error('Reschedule appointment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get queue status for today
router.get('/queue/status', authMiddleware, receptionistMiddleware, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get all appointments for today grouped by doctor
    const appointments = await Token.find({
      booking_date: { $gte: today, $lt: tomorrow },
      status: { $nin: ['cancelled', 'missed', 'completed'] }
    })
    .populate('doctor_id', 'name doctor_info')
    .populate('patient_id', 'name phone')
    .populate('family_member_id', 'name age relation')
    .sort({ time_slot: 1 });

    // Group by doctor
    const queueByDoctor = {};
    appointments.forEach(apt => {
      const doctorId = apt.doctor_id._id.toString();
      if (!queueByDoctor[doctorId]) {
        queueByDoctor[doctorId] = {
          doctor: {
            id: apt.doctor_id._id,
            name: apt.doctor_id.name,
            department: apt.doctor_id.doctor_info?.department
          },
          appointments: []
        };
      }
      
      queueByDoctor[doctorId].appointments.push({
        _id: apt._id,
        tokenNumber: apt.token_number,
        patientName: apt.family_member_id ? apt.family_member_id.name : apt.patient_id.name,
        patientPhone: apt.patient_id.phone,
        timeSlot: apt.time_slot,
        status: apt.status,
        symptoms: apt.symptoms,
        estimatedWaitTime: apt.estimated_wait_time,
        isFamilyMember: !!apt.family_member_id
      });
    });

    // Calculate queue statistics
    const totalWaiting = appointments.filter(apt => apt.status === 'booked' || apt.status === 'confirmed').length;
    const inProgress = appointments.filter(apt => apt.status === 'in-progress').length;
    const completed = await Token.countDocuments({
      booking_date: { $gte: today, $lt: tomorrow },
      status: 'completed'
    });

    res.json({
      queueByDoctor: Object.values(queueByDoctor),
      statistics: {
        totalWaiting,
        inProgress,
        completed,
        totalToday: appointments.length
      },
      lastUpdated: new Date()
    });
  } catch (error) {
    console.error('Get queue status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Search patients
router.get('/patients/search', authMiddleware, receptionistMiddleware, async (req, res) => {
  try {
    const { query, page = 1, limit = 20 } = req.query;

    if (!query || query.length < 2) {
      return res.status(400).json({ message: 'Search query must be at least 2 characters' });
    }

    const searchRegex = new RegExp(query, 'i');
    const skip = (page - 1) * limit;

    const patients = await User.find({
      role: 'patient',
      $or: [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex }
      ]
    })
    .select('name email phone dob gender patient_info')
    .sort({ name: 1 })
    .skip(skip)
    .limit(parseInt(limit));

    const total = await User.countDocuments({
      role: 'patient',
      $or: [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex }
      ]
    });

    // Get recent appointments for each patient
    const patientsWithAppointments = await Promise.all(
      patients.map(async (patient) => {
        const recentAppointments = await Token.find({
          patient_id: patient._id
        })
        .populate('doctor_id', 'name')
        .sort({ booking_date: -1 })
        .limit(3);

        return {
          _id: patient._id,
          name: patient.name,
          email: patient.email,
          phone: patient.phone,
          dob: patient.dob,
          gender: patient.gender,
          familyMembersCount: patient.patient_info?.family_members?.length || 0,
          recentAppointments: recentAppointments.map(apt => ({
            _id: apt._id,
            doctorName: apt.doctor_id.name,
            date: apt.booking_date,
            status: apt.status,
            tokenNumber: apt.token_number
          }))
        };
      })
    );

    res.json({
      patients: patientsWithAppointments,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Search patients error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient details
router.get('/patients/:id', authMiddleware, receptionistMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const patient = await User.findById(id)
      .select('name email phone dob gender patient_info')
      .populate('patient_info.family_members.member_id');

    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Get all appointments for this patient
    const appointments = await Token.find({
      patient_id: id
    })
    .populate('doctor_id', 'name doctor_info')
    .populate('family_member_id', 'name age relation')
    .sort({ booking_date: -1 });

    res.json({
      patient: {
        _id: patient._id,
        name: patient.name,
        email: patient.email,
        phone: patient.phone,
        dob: patient.dob,
        gender: patient.gender,
        familyMembers: patient.patient_info?.family_members || [],
        totalAppointments: appointments.length
      },
      appointments: appointments.map(apt => ({
        _id: apt._id,
        tokenNumber: apt.token_number,
        doctorName: apt.doctor_id.name,
        department: apt.department,
        appointmentDate: apt.booking_date,
        timeSlot: apt.time_slot,
        status: apt.status,
        symptoms: apt.symptoms,
        paymentStatus: apt.payment_status,
        isFamilyMember: !!apt.family_member_id,
        familyMemberInfo: apt.family_member_id
      }))
    });
  } catch (error) {
    console.error('Get patient details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new appointment (receptionist booking)
router.post('/appointments', authMiddleware, receptionistMiddleware, async (req, res) => {
  try {
    const {
      patientId,
      doctorId,
      departmentId,
      appointmentDate,
      appointmentTime,
      symptoms,
      familyMemberId,
      notes
    } = req.body;

    // Validate required fields
    if (!patientId || !doctorId || !departmentId || !appointmentDate || !appointmentTime) {
      return res.status(400).json({ message: 'patientId, doctorId, departmentId, appointmentDate and appointmentTime are required' });
    }

    // Get patient and doctor details
    const patient = await User.findById(patientId);
    const doctor = await User.findById(doctorId)
      .populate('doctor_info.department', 'name');

    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ message: 'Patient not found' });
    }

    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const department = await Department.findById(departmentId);
    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }

    // Validate appointment date and time
    const selectedDate = new Date(appointmentDate);
    selectedDate.setHours(0, 0, 0, 0);

    // Check if doctor is available on that date (timezone-safe day range)
    const endOfDay = new Date(selectedDate);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const schedule = await DoctorSchedule.findOne({
      doctor_id: doctorId,
      date: { $gte: selectedDate, $lt: endOfDay }
    });

    if (!schedule || !schedule.is_available) {
      return res.status(400).json({ 
        message: `Doctor is not available on ${appointmentDate}` 
      });
    }

    // Check if time slot is available
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const existingAppointment = await Token.findOne({
      doctor_id: doctorId,
      booking_date: { $gte: selectedDate, $lt: nextDay },
      time_slot: appointmentTime,
      status: { $nin: ['cancelled', 'missed'] }
    });

    if (existingAppointment) {
      return res.status(400).json({ 
        message: 'Time slot is already booked' 
      });
    }

    // Block multiple active appointments in the same department on the same date (for self or same family member)
    const activeSameDepartmentQuery = {
      patient_id: patientId,
      department: department.name,
      booking_date: { $gte: selectedDate, $lt: endOfDay }, // Add date check
      status: { $in: ['booked', 'in_queue'] }
    };
    if (familyMemberId && familyMemberId !== 'self') {
      activeSameDepartmentQuery.family_member_id = familyMemberId;
    } else {
      activeSameDepartmentQuery.family_member_id = null;
    }
    const existingActiveSameDept = await Token.findOne(activeSameDepartmentQuery);
    if (existingActiveSameDept) {
      return res.status(400).json({
        message: 'Cannot book another appointment in the same department on the same date until the current one is completed or cancelled'
      });
    }

    // Validate family member if provided and normalize 'self'
    let familyMemberObjectId = null;
    if (familyMemberId && familyMemberId !== 'self') {
      const fm = await FamilyMember.findOne({ _id: familyMemberId, patient_id: patientId, isActive: true });
      if (!fm) {
        return res.status(404).json({ message: 'Family member not found' });
      }
      familyMemberObjectId = fm._id;
    }

    // Determine session type based on appointment time
    const appointmentMinutes = parseTime(appointmentTime);
    const sessionInfo = getSessionInfo(appointmentTime);
    const sessionType = sessionInfo.type;

    // Generate sequential token number based on session type
    const tokenNumber = await generateSequentialTokenNumber(doctorId, selectedDate, sessionType, patientId, familyMemberObjectId);

    // Calculate sequential time slot based on token number and slot duration
    const slotDuration = schedule?.slot_duration || 30;
    const sequentialTimeSlot = calculateSequentialTimeSlot(tokenNumber, sessionType, slotDuration);
    console.log(`[RECEPTIONIST-BOOK] Token: ${tokenNumber}, Original time: ${appointmentTime}, Sequential time: ${sequentialTimeSlot}`);

    // Create appointment
    const appointment = new Token({
      patient_id: patientId,
      patient_name: familyMemberObjectId ? (await FamilyMember.findById(familyMemberObjectId)).name : patient.name,
      patient_email: patient.email,
      family_member_id: familyMemberObjectId,
      doctor_id: doctorId,
      department: department.name,
      symptoms: symptoms && String(symptoms).trim().length > 0 ? symptoms : 'Not provided',
      booking_date: selectedDate,
      time_slot: sequentialTimeSlot,
      status: 'booked',
      token_number: tokenNumber,
      payment_status: 'pending',
      created_by: 'receptionist',
      receptionist_notes: notes,
      estimated_wait_time: Math.floor(Math.random() * 30) + 15,
      session_type: sessionType,
      session_time_range: sessionInfo.name
    });

    await appointment.save();

    // Update patient's booking history
    await User.findByIdAndUpdate(
      patientId,
      { $push: { 'patient_info.booking_history': appointment._id } }
    );

    // Send WhatsApp confirmation
    const whatsappBotService = require('../services/whatsappBotService');
    whatsappBotService.sendBookingConfirmation(appointment._id).then(() => {
      console.log('✅ WhatsApp booking confirmation sent successfully');
    }).catch((error) => {
      console.error('❌ Error sending WhatsApp booking confirmation:', error);
    });

    res.status(201).json({
      message: 'Appointment created successfully',
      appointment: {
        _id: appointment._id,
        tokenNumber: appointment.token_number,
        patientName: familyMemberObjectId ? (await FamilyMember.findById(familyMemberObjectId)).name : patient.name,
        doctorName: doctor.name,
        department: department.name,
        appointmentDate: appointment.booking_date,
        timeSlot: appointment.time_slot,
        status: appointment.status
      }
    });
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get billing information for appointments
router.get('/billing/appointments', authMiddleware, receptionistMiddleware, async (req, res) => {
  try {
    const { date, status = 'pending' } = req.query;

    let query = { payment_status: status };

    if (date) {
      const selectedDate = new Date(date);
      selectedDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(selectedDate);
      nextDay.setDate(nextDay.getDate() + 1);
      query.booking_date = { $gte: selectedDate, $lt: nextDay };
    }

    const appointments = await Token.find(query)
      .populate('patient_id', 'name email phone')
      .populate('doctor_id', 'name doctor_info')
      .populate('family_member_id', 'name age relation')
      .sort({ booking_date: -1 });

    const billingData = appointments.map(apt => ({
      _id: apt._id,
      tokenNumber: apt.token_number,
      patientName: apt.family_member_id ? apt.family_member_id.name : apt.patient_id.name,
      patientEmail: apt.patient_id.email,
      patientPhone: apt.patient_id.phone,
      doctorName: apt.doctor_id.name,
      department: apt.department,
      appointmentDate: apt.booking_date,
      timeSlot: apt.time_slot,
      consultationFee: apt.doctor_id.doctor_info?.consultation_fee || 500,
      paymentStatus: apt.payment_status,
      paymentMethod: apt.payment_method || 'pending',
      paidAmount: apt.paid_amount || 0
    }));

    const totalPending = billingData.filter(item => item.paymentStatus === 'pending').length;
    const totalPaid = billingData.filter(item => item.paymentStatus === 'paid').length;
    const totalRevenue = billingData
      .filter(item => item.paymentStatus === 'paid')
      .reduce((sum, item) => sum + item.paidAmount, 0);

    res.json({
      appointments: billingData,
      summary: {
        totalPending,
        totalPaid,
        totalRevenue,
        totalAppointments: billingData.length
      }
    });
  } catch (error) {
    console.error('Get billing information error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update payment status
router.patch('/billing/appointments/:id/payment', authMiddleware, receptionistMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus, paymentMethod, paidAmount, notes } = req.body;

    if (!paymentStatus) {
      return res.status(400).json({ message: 'Payment status is required' });
    }

    const validStatuses = ['pending', 'paid', 'partial', 'refunded'];
    if (!validStatuses.includes(paymentStatus)) {
      return res.status(400).json({ message: 'Invalid payment status' });
    }

    const updateData = {
      payment_status: paymentStatus,
      updated_at: new Date()
    };

    if (paymentMethod) updateData.payment_method = paymentMethod;
    if (paidAmount) updateData.paid_amount = paidAmount;
    if (notes) updateData.payment_notes = notes;

    const appointment = await Token.findByIdAndUpdate(id, updateData, { new: true })
      .populate('patient_id', 'name email phone')
      .populate('doctor_id', 'name doctor_info')
      .populate('family_member_id', 'name age relation');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Send automatic invoice email if payment status is 'paid'
    let invoiceSent = false;
    if (paymentStatus === 'paid') {
      try {
        console.log('🔍 Receptionist payment - Sending automatic invoice email for appointment:', id);
        
        const invoiceData = {
          invoiceNumber: `INV-${appointment.token_number || appointment._id.toString().slice(-6)}`,
          date: appointment.createdAt.toLocaleDateString('en-IN'),
          patientName: appointment.family_member_id ? appointment.family_member_id.name : appointment.patient_id.name,
          patientEmail: appointment.patient_id.email,
          doctorName: appointment.doctor_id?.name || 'Unknown Doctor',
          department: appointment.department,
          appointmentDate: appointment.booking_date.toLocaleDateString('en-IN'),
          timeSlot: appointment.time_slot,
          amount: appointment.paid_amount || 500,
          status: 'paid',
          transactionId: appointment.payment_reference || `PAY${Date.now().toString().slice(-8)}`,
          currentDate: new Date().toLocaleDateString('en-IN'),
          currentTime: new Date().toLocaleTimeString('en-IN')
        };

        // Generate professional HTML content for PDF (same as patient route)
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Invoice ${invoiceData.invoiceNumber}</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    line-height: 1.6; 
                    color: #333; 
                    background: #fff;
                    font-size: 14px;
                    padding: 20px;
                }
                .invoice-container { 
                    max-width: 800px; 
                    margin: 0 auto; 
                    background: white; 
                    box-shadow: 0 0 20px rgba(0,0,0,0.1); 
                    border-radius: 8px; 
                    overflow: hidden;
                }
                .header { 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                    color: white; 
                    padding: 30px; 
                    text-align: center; 
                }
                .header h1 { 
                    font-size: 28px; 
                    margin-bottom: 10px; 
                    font-weight: 700; 
                }
                .header p { 
                    font-size: 16px; 
                    opacity: 0.9; 
                }
                .invoice-details { 
                    padding: 30px; 
                    background: #f8fafc; 
                    border-bottom: 1px solid #e2e8f0; 
                }
                .invoice-number { 
                    font-size: 24px; 
                    font-weight: 700; 
                    color: #1f2937; 
                    margin-bottom: 20px; 
                }
                .invoice-meta { 
                    display: grid; 
                    grid-template-columns: 1fr 1fr; 
                    gap: 20px; 
                    margin-bottom: 20px; 
                }
                .meta-item { 
                    background: white; 
                    padding: 15px; 
                    border-radius: 6px; 
                    border-left: 4px solid #3b82f6; 
                }
                .meta-label { 
                    font-size: 12px; 
                    color: #6b7280; 
                    text-transform: uppercase; 
                    font-weight: 600; 
                    margin-bottom: 5px; 
                }
                .meta-value { 
                    font-size: 16px; 
                    color: #1f2937; 
                    font-weight: 600; 
                }
                .content { 
                    padding: 30px; 
                }
                .section { 
                    margin-bottom: 30px; 
                }
                .section-title { 
                    font-size: 18px; 
                    font-weight: 700; 
                    color: #1f2937; 
                    margin-bottom: 20px; 
                    border-bottom: 2px solid #e5e7eb; 
                    padding-bottom: 8px; 
                }
                .info-grid { 
                    display: grid; 
                    grid-template-columns: 1fr 1fr; 
                    gap: 30px; 
                    margin-bottom: 25px; 
                }
                .info-item { 
                    padding: 15px;
                    background: #f9fafb;
                    border-radius: 6px;
                    border-left: 4px solid #2563eb;
                }
                .info-label { 
                    font-size: 11px; 
                    color: #6b7280; 
                    text-transform: uppercase; 
                    font-weight: 600; 
                    margin-bottom: 5px; 
                }
                .info-value { 
                    font-size: 14px; 
                    color: #1f2937; 
                    font-weight: 600; 
                }
                .amount-section { 
                    background: #f0f9ff; 
                    padding: 25px; 
                    border-radius: 8px; 
                    border: 2px solid #0ea5e9; 
                    text-align: center; 
                    margin: 30px 0; 
                }
                .amount-label { 
                    font-size: 14px; 
                    color: #0369a1; 
                    margin-bottom: 10px; 
                    font-weight: 600; 
                }
                .amount-value { 
                    font-size: 32px; 
                    color: #0c4a6e; 
                    font-weight: 800; 
                    margin-bottom: 5px; 
                }
                .amount-currency { 
                    font-size: 16px; 
                    color: #0369a1; 
                    font-weight: 600; 
                }
                .status-badge { 
                    display: inline-block; 
                    padding: 8px 16px; 
                    border-radius: 20px; 
                    font-size: 12px; 
                    font-weight: 600; 
                    text-transform: uppercase; 
                    margin-top: 10px; 
                }
                .status-paid { 
                    background: #dcfce7; 
                    color: #166534; 
                }
                .footer { 
                    background: #1f2937; 
                    color: white; 
                    padding: 25px; 
                    text-align: center; 
                }
                .footer p { 
                    margin-bottom: 10px; 
                    opacity: 0.8; 
                }
                .footer .highlight { 
                    color: #60a5fa; 
                    font-weight: 600; 
                }
            </style>
        </head>
        <body>
            <div class="invoice-container">
                <div class="header">
                    <h1>Medical Invoice</h1>
                    <p>Professional Healthcare Services</p>
                </div>
                
                <div class="invoice-details">
                    <div class="invoice-number">Invoice #${invoiceData.invoiceNumber}</div>
                    <div class="invoice-meta">
                        <div class="meta-item">
                            <div class="meta-label">Invoice Date</div>
                            <div class="meta-value">${invoiceData.currentDate}</div>
                        </div>
                        <div class="meta-item">
                            <div class="meta-label">Transaction ID</div>
                            <div class="meta-value">${invoiceData.transactionId}</div>
                        </div>
                    </div>
                </div>
                
                <div class="content">
                    <div class="section">
                        <div class="section-title">Patient Information</div>
                        <div class="info-grid">
                            <div class="info-item">
                                <div class="info-label">Patient Name</div>
                                <div class="info-value">${invoiceData.patientName}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">Email Address</div>
                                <div class="info-value">${invoiceData.patientEmail}</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="section">
                        <div class="section-title">Appointment Details</div>
                        <div class="info-grid">
                            <div class="info-item">
                                <div class="info-label">Doctor</div>
                                <div class="info-value">Dr. ${invoiceData.doctorName}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">Department</div>
                                <div class="info-value">${invoiceData.department}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">Appointment Date</div>
                                <div class="info-value">${invoiceData.appointmentDate}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">Time Slot</div>
                                <div class="info-value">${invoiceData.timeSlot}</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="amount-section">
                        <div class="amount-label">Total Amount</div>
                        <div class="amount-value">₹${invoiceData.amount}</div>
                        <div class="amount-currency">Indian Rupees</div>
                        <div class="status-badge status-paid">PAID</div>
                    </div>
                </div>
                
                <div class="footer">
                    <p>Thank you for choosing our healthcare services!</p>
                    <p>For any queries, please contact our support team.</p>
                    <p>Generated on <span class="highlight">${invoiceData.currentDate}</span> at <span class="highlight">${invoiceData.currentTime}</span></p>
                </div>
            </div>
        </body>
        </html>
        `;

        // Generate PDF using Puppeteer
        const puppeteer = require('puppeteer');
        let browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: {
            top: '20px',
            right: '20px',
            bottom: '20px',
            left: '20px'
          }
        });

        await browser.close();

        // Send email with PDF attachment
        const emailService = require('../services/emailService');
        await emailService.sendEmail({
          to: appointment.patient_id.email,
          subject: `Payment Confirmation & Invoice ${invoiceData.invoiceNumber} - MediQ Healthcare Services`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 24px;">Payment Successful! 🎉</h1>
                <p style="margin: 10px 0 0 0; opacity: 0.9;">Your payment has been processed successfully</p>
              </div>
              
              <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="text-align: center; margin-bottom: 30px;">
                  <div style="width: 80px; height: 80px; background: #dcfce7; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                    <span style="font-size: 32px;">✅</span>
                  </div>
                  <h2 style="color: #1f2937; margin: 0 0 10px 0;">Payment Confirmed</h2>
                  <p style="color: #6b7280; margin: 0;">Your payment of ₹${invoiceData.amount} has been successfully processed.</p>
                </div>
                
                <div class="invoice-details" style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                  <h3 style="color: #1f2937; margin: 0 0 15px 0;">📋 Payment Details</h3>
                  <p style="margin: 5px 0; color: #374151;"><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
                  <p style="margin: 5px 0; color: #374151;"><strong>Patient:</strong> ${invoiceData.patientName}</p>
                  <p style="margin: 5px 0; color: #374151;"><strong>Doctor:</strong> Dr. ${invoiceData.doctorName}</p>
                  <p style="margin: 5px 0; color: #374151;"><strong>Department:</strong> ${invoiceData.department}</p>
                  <p style="margin: 5px 0; color: #374151;"><strong>Date:</strong> ${invoiceData.appointmentDate}</p>
                  <p style="margin: 5px 0; color: #374151;"><strong>Time:</strong> ${invoiceData.timeSlot}</p>
                  <p style="margin: 5px 0; color: #374151;"><strong>Amount Paid:</strong> ₹${invoiceData.amount}</p>
                  <p style="margin: 5px 0; color: #374151;"><strong>Transaction ID:</strong> ${invoiceData.transactionId}</p>
                  <p style="margin: 5px 0; color: #374151;"><strong>Status:</strong> <span style="color: #16a34a;">PAID</span></p>
                </div>
                
                <div style="background: #dbeafe; border: 1px solid #3b82f6; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                  <h4 style="color: #1e40af; margin: 0 0 10px 0;">📄 Invoice Attached</h4>
                  <p style="color: #1e40af; margin: 0;">Your detailed invoice has been attached to this email as a PDF document.</p>
                  <p style="color: #1e40af; margin: 5px 0 0 0; font-size: 14px;">You can download and save it for your records.</p>
                </div>
                
                <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                  <h4 style="color: #92400e; margin: 0 0 10px 0;">📅 Next Steps</h4>
                  <ul style="color: #92400e; margin: 0; padding-left: 20px;">
                    <li>Your appointment is confirmed for ${invoiceData.appointmentDate} at ${invoiceData.timeSlot}</li>
                    <li>Please arrive 15 minutes before your scheduled time</li>
                    <li>Bring a valid ID and any relevant medical documents</li>
                    <li>Contact us if you need to reschedule or have any questions</li>
                  </ul>
                </div>
                
                <div style="text-align: center; margin-top: 30px;">
                  <p style="color: #6b7280; font-size: 14px;">Thank you for choosing MediQ for your healthcare needs.</p>
                  <p style="color: #6b7280; font-size: 14px;">If you have any questions, please contact our support team.</p>
                </div>
              </div>
            </div>
          `,
          attachments: [
            {
              filename: `Invoice-${invoiceData.invoiceNumber}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf'
            }
          ]
        });

        console.log('✅ Receptionist payment - Invoice email sent successfully to:', appointment.patient_id.email);
        invoiceSent = true;
      } catch (emailError) {
        console.error('❌ Receptionist payment - Failed to send automatic invoice email:', emailError);
        // Don't fail the payment process if email fails
      }
    }

    res.json({
      message: 'Payment status updated successfully',
      appointment: {
        _id: appointment._id,
        tokenNumber: appointment.token_number,
        patientName: appointment.family_member_id ? appointment.family_member_id.name : appointment.patient_id.name,
        doctorName: appointment.doctor_id.name,
        paymentStatus: appointment.payment_status,
        paidAmount: appointment.paid_amount,
        paymentMethod: appointment.payment_method
      },
      invoiceSent: invoiceSent
    });
  } catch (error) {
    console.error('Update payment status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get receptionist dashboard statistics
router.get('/dashboard/stats', authMiddleware, receptionistMiddleware, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      todayAppointments,
      pendingPayments,
      completedAppointments,
      totalPatients
    ] = await Promise.all([
      Token.countDocuments({
        booking_date: { $gte: today, $lt: tomorrow },
        status: { $nin: ['cancelled', 'missed'] }
      }),
      Token.countDocuments({
        payment_status: 'pending'
      }),
      Token.countDocuments({
        booking_date: { $gte: today, $lt: tomorrow },
        status: 'completed'
      }),
      User.countDocuments({ role: 'patient' })
    ]);

    // Get revenue for today
    const todayRevenue = await Token.aggregate([
      {
        $match: {
          booking_date: { $gte: today, $lt: tomorrow },
          payment_status: 'paid'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$paid_amount' }
        }
      }
    ]);

    res.json({
      todayAppointments,
      pendingPayments,
      completedAppointments,
      totalPatients,
      todayRevenue: todayRevenue[0]?.total || 0
    });
  } catch (error) {
    console.error('Get receptionist stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;