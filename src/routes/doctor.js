const express = require('express');
const router = express.Router();
const { User, Appointment, Token } = require('../models/User');
const DoctorSchedule = require('../models/DoctorSchedule');
const DoctorStats = require('../models/DoctorStats');
const DoctorStatsService = require('../services/doctorStatsService');
const { authMiddleware } = require('../middleware/authMiddleware');

// Middleware to check if user is a doctor
const doctorMiddleware = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || user.role !== 'doctor') {
      return res.status(403).json({ message: 'Access denied. Doctor role required.' });
    }
    req.doctor = user;
    next();
  } catch (error) {
    console.error('Doctor middleware error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get doctor's appointments from tokens collection
router.get('/appointments', authMiddleware, doctorMiddleware, async (req, res) => {
  try {
    const { filter = 'today', page = 1, limit = 10, date } = req.query;
    const doctorId = req.doctor._id;

    let dateFilter = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // If specific date is provided, use it
    if (date) {
      const selectedDate = new Date(date);
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
          dateFilter = {
            booking_date: { $gte: today }
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

    const appointments = await Token.find({
      doctor_id: doctorId,
      ...dateFilter
    })
    .populate('patient_id', 'name email phone patient_info')
    .sort({ booking_date: 1, time_slot: 1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    const totalAppointments = await Token.countDocuments({
      doctor_id: doctorId,
      ...dateFilter
    });

    // Transform to match expected format
    const transformedAppointments = appointments.map(apt => ({
      _id: apt._id,
      patient_name: apt.patient_id?.name || 'Unknown Patient',
      patientName: apt.patient_id?.name || 'Unknown Patient',
      patientEmail: apt.patient_id?.email || '',
      patientPhone: apt.patient_id?.phone || '',
      booking_date: apt.booking_date,
      appointmentDate: apt.booking_date,
      time_slot: apt.time_slot,
      appointmentTime: apt.time_slot,
      appointmentType: 'consultation', // Default type
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
      estimatedWaitTime: apt.estimated_wait_time
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
    const { status, notes } = req.body;
    const validStatuses = ['booked', 'in_queue', 'consulted', 'cancelled', 'missed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const appointment = await Token.findOneAndUpdate(
      {
        _id: req.params.appointmentId,
        doctor_id: req.doctor._id
      },
      { status },
      { new: true }
    ).populate('patient_id', 'name email phone');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
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
        max_patients_per_slot: maxPatientsPerSlot || 1,
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
      // No schedule set, assume available with default hours
      res.json({
        isAvailable: true,
        workingHours: {
          start_time: '09:00',
          end_time: '17:00'
        },
        breakTime: {
          start_time: '13:00',
          end_time: '14:00'
        },
        slotDuration: 30
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
      profile_photo 
    } = req.body;

    const updateData = {};
    if (specialization) updateData['doctor_info.specialization'] = specialization;
    if (experience_years) updateData['doctor_info.experience_years'] = experience_years;
    if (consultation_fee) updateData['doctor_info.consultation_fee'] = consultation_fee;
    if (phone) updateData.phone = phone;
    if (profile_photo) updateData.profile_photo = profile_photo;

    const updatedDoctor = await User.findByIdAndUpdate(
      doctorId,
      { $set: updateData },
      { new: true }
    ).select('-password');

    res.json({
      message: 'Profile updated successfully',
      doctor: updatedDoctor
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

module.exports = router;
