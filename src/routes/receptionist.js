const express = require('express');
const router = express.Router();
const { User, Token, Appointment } = require('../models/User');
const Department = require('../models/Department');
const DoctorSchedule = require('../models/DoctorSchedule');
const { authMiddleware } = require('../middleware/authMiddleware');

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

    // Block multiple active appointments in the same department (for self or same family member)
    const activeSameDepartmentQuery = {
      patient_id: patientId,
      department: department.name,
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
        message: 'Cannot book another appointment in the same department until the current one is completed or cancelled'
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

    // Generate token number
    const tokenNumber = `T${Date.now().toString().slice(-4)}`;

    // Create appointment
    const appointment = new Token({
      patient_id: patientId,
      family_member_id: familyMemberObjectId,
      doctor_id: doctorId,
      department: department.name,
      symptoms: symptoms && String(symptoms).trim().length > 0 ? symptoms : 'Not provided',
      booking_date: selectedDate,
      time_slot: appointmentTime,
      status: 'booked',
      token_number: tokenNumber,
      payment_status: 'pending',
      created_by: 'receptionist',
      receptionist_notes: notes,
      estimated_wait_time: Math.floor(Math.random() * 30) + 15
    });

    await appointment.save();

    // Update patient's booking history
    await User.findByIdAndUpdate(
      patientId,
      { $push: { 'patient_info.booking_history': appointment._id } }
    );

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
      }
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