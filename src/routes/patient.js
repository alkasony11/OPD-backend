const express = require('express');
const router = express.Router();
const { User, Token, Appointment } = require('../models/User');
const Department = require('../models/Department');
const FamilyMember = require('../models/FamilyMember');
const DoctorSchedule = require('../models/DoctorSchedule');
const { authMiddleware } = require('../middleware/authMiddleware');

// Middleware to check if user is a patient
const patientMiddleware = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || user.role !== 'patient') {
      return res.status(403).json({ message: 'Access denied. Patient role required.' });
    }
    req.patient = user;
    next();
  } catch (error) {
    console.error('Patient middleware error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get all active departments
router.get('/departments', async (req, res) => {
  try {
    const departments = await Department.find({ isActive: true })
      .select('_id name description icon')
      .sort({ name: 1 });

    const departmentList = departments.map(dept => ({
      id: dept._id,
      name: dept.name,
      description: dept.description,
      icon: dept.icon
    }));

    res.json({ departments: departmentList });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get doctors by department ID with availability info
router.get('/doctors/:departmentId', async (req, res) => {
  try {
    const { departmentId } = req.params;

    const doctors = await User.find({
      role: 'doctor',
      'doctor_info.department': departmentId
    })
    .select('name doctor_info email profile_photo')
    .populate('doctor_info.department', 'name');

    // Add availability info for each doctor
    const doctorsWithAvailability = await Promise.all(
      doctors.map(async (doctor) => {
        // Check if doctor has any available schedules in the next 30 days
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + 30);

        const availableSchedules = await DoctorSchedule.countDocuments({
          doctor_id: doctor._id,
          date: { $gte: today, $lte: futureDate },
          is_available: true
        });

        // Count total schedules (including unavailable ones)
        const totalSchedules = await DoctorSchedule.countDocuments({
          doctor_id: doctor._id,
          date: { $gte: today, $lte: futureDate }
        });

        // If no schedules exist, assume doctor is available with default hours
        const isAvailable = totalSchedules === 0 || availableSchedules > 0;

        return {
          id: doctor._id,
          name: doctor.name,
          email: doctor.email,
          specialization: doctor.doctor_info?.specialization || 'General Medicine',
          department: doctor.doctor_info.department?.name,
          departmentId: doctor.doctor_info.department?._id,
          experience: doctor.doctor_info?.experience_years || 0,
          fee: doctor.doctor_info?.consultation_fee || 500,
          profilePhoto: doctor.profile_photo,
          rating: 4.5, // Default rating - you can add this to doctor_info later
          reviews: 50, // Default reviews - you can add this to doctor_info later
          isAvailable,
          availableDays: availableSchedules,
          nextAvailableDate: isAvailable ? today.toISOString().split('T')[0] : null
        };
      })
    );

    // Sort by availability first, then by name
    doctorsWithAvailability.sort((a, b) => {
      if (a.isAvailable && !b.isAvailable) return -1;
      if (!a.isAvailable && b.isAvailable) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ doctors: doctorsWithAvailability });
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get available dates for a doctor (next 30 days)
router.get('/doctors/:doctorId/available-dates', async (req, res) => {
  try {
    const { doctorId } = req.params;

    const doctor = await User.findById(doctorId).select('name doctor_info role');

    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + 30);

    // Get all schedules for this doctor in the next 30 days
    const schedules = await DoctorSchedule.find({
      doctor_id: doctorId,
      date: { $gte: today, $lte: futureDate }
    }).sort({ date: 1 });

    // Get doctor's default working hours
    const defaultHours = doctor.doctor_info?.default_working_hours || {
      start_time: '09:00',
      end_time: '17:00'
    };
    const defaultBreak = doctor.doctor_info?.default_break_time || {
      start_time: '13:00',
      end_time: '14:00'
    };

    const availableDates = [];

    // Check each day for the next 30 days
    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(today.getDate() + i);
      const dateStr = checkDate.toISOString().split('T')[0];

      // Skip Sundays (assuming doctors don't work on Sundays by default)
      if (checkDate.getDay() === 0) continue;

      // Check if doctor has a specific schedule for this date
      const daySchedule = schedules.find(s => 
        s.date.toISOString().split('T')[0] === dateStr
      );

      let isAvailable = true;
      let workingHours = defaultHours;
      let breakTime = defaultBreak;
      let leaveReason = '';

      if (daySchedule) {
        isAvailable = daySchedule.is_available;
        workingHours = daySchedule.working_hours;
        breakTime = daySchedule.break_time;
        leaveReason = daySchedule.leave_reason || '';
      }

      // Only include available dates
      if (isAvailable) {
        // Check if there are any available slots for this date
        const nextDay = new Date(checkDate);
        nextDay.setDate(checkDate.getDate() + 1);

        const existingAppointments = await Token.countDocuments({
          doctor_id: doctorId,
          booking_date: { $gte: checkDate, $lt: nextDay },
          status: { $nin: ['cancelled', 'missed'] }
        });

        // Calculate total possible slots
        const totalSlots = calculateTotalSlots(workingHours, breakTime, 30);
        const availableSlots = totalSlots - existingAppointments;

        if (availableSlots > 0) {
          availableDates.push({
            date: dateStr,
            dayName: checkDate.toLocaleDateString('en-US', { weekday: 'long' }),
            isToday: i === 0,
            workingHours: {
              start: workingHours.start_time,
              end: workingHours.end_time
            },
            breakTime: {
              start: breakTime.start_time,
              end: breakTime.end_time
            },
            availableSlots,
            totalSlots
          });
        }
      }
    }

    res.json({ availableDates });
  } catch (error) {
    console.error('Get available dates error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to calculate total slots
function calculateTotalSlots(workingHours, breakTime, slotDuration) {
  const startTime = parseTime(workingHours.start_time);
  const endTime = parseTime(workingHours.end_time);
  const breakStart = parseTime(breakTime.start_time);
  const breakEnd = parseTime(breakTime.end_time);

  const totalWorkingMinutes = (endTime - startTime) - (breakEnd - breakStart);
  return Math.floor(totalWorkingMinutes / slotDuration);
}

// Helper function to parse time string to minutes
function parseTime(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// Get available time slots for a doctor on a specific date
router.get('/doctors/:doctorId/availability/:date', async (req, res) => {
  try {
    const { doctorId, date } = req.params;
    
    const doctor = await User.findById(doctorId).select('name doctor_info role');
    
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);
    
    // Get doctor's schedule for this date
    const schedule = await DoctorSchedule.findOne({
      doctor_id: doctorId,
      date: selectedDate
    });

    // Use schedule if exists, otherwise use default hours
    let workingHours, breakTime, slotDuration;
    
    if (schedule) {
      if (!schedule.is_available) {
        return res.json({ 
          slots: [], 
          message: `Doctor is not available on ${date}. Reason: ${schedule.leave_reason || 'Not specified'}`,
          isAvailable: false,
          leaveReason: schedule.leave_reason
        });
      }
      workingHours = schedule.working_hours;
      breakTime = schedule.break_time;
      slotDuration = schedule.slot_duration || 30;
    } else {
      // Use doctor's default hours
      workingHours = doctor.doctor_info?.default_working_hours || {
        start_time: '09:00',
        end_time: '17:00'
      };
      breakTime = doctor.doctor_info?.default_break_time || {
        start_time: '13:00',
        end_time: '14:00'
      };
      slotDuration = doctor.doctor_info?.default_slot_duration || 30;
    }

    // Generate time slots
    const slots = generateTimeSlots(workingHours, breakTime, slotDuration);

    // Get existing appointments for this date
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const existingAppointments = await Token.find({
      doctor_id: doctorId,
      booking_date: { $gte: selectedDate, $lt: nextDay },
      status: { $nin: ['cancelled', 'missed'] }
    });

    const bookedSlots = existingAppointments.map(apt => apt.time_slot);

    // Mark slots as booked and add additional info
    const availableSlots = slots.map((slot, index) => {
      const isBooked = bookedSlots.includes(slot.time);
      return {
        time: slot.time,
        displayTime: slot.displayTime,
        available: !isBooked,
        isBooked,
        estimatedWaitTime: index * 5 + 10, // Progressive wait time
        slotNumber: index + 1
      };
    });

    // Filter to only available slots
    const onlyAvailableSlots = availableSlots.filter(slot => slot.available);

    res.json({ 
      slots: onlyAvailableSlots,
      allSlots: availableSlots, // Include all slots for debugging
      workingHours,
      breakTime,
      slotDuration,
      isAvailable: true,
      totalSlots: slots.length,
      availableCount: onlyAvailableSlots.length,
      bookedCount: availableSlots.length - onlyAvailableSlots.length
    });
  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to generate time slots
function generateTimeSlots(workingHours, breakTime, slotDuration) {
  const slots = [];
  const startTime = parseTime(workingHours.start_time);
  const endTime = parseTime(workingHours.end_time);
  const breakStart = parseTime(breakTime.start_time);
  const breakEnd = parseTime(breakTime.end_time);

  let currentTime = startTime;

  while (currentTime < endTime) {
    const slotEndTime = currentTime + slotDuration;
    
    // Skip if slot overlaps with break time
    const isBreakTime = (currentTime >= breakStart && currentTime < breakEnd) ||
                       (slotEndTime > breakStart && slotEndTime <= breakEnd) ||
                       (currentTime < breakStart && slotEndTime > breakEnd);

    if (!isBreakTime && slotEndTime <= endTime) {
      slots.push({
        time: formatTime(currentTime),
        displayTime: formatDisplayTime(currentTime),
        duration: slotDuration
      });
    }

    currentTime += slotDuration;
  }

  return slots;
}

// Helper function to format minutes to time string (24-hour format)
function formatTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// Helper function to format display time (12-hour format)
function formatDisplayTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

// Book an appointment
router.post('/book-appointment', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const {
      doctorId,
      departmentId,
      appointmentDate,
      appointmentTime,
      symptoms,
      familyMemberId
    } = req.body;

    // Validate required fields
    if (!doctorId || !departmentId || !appointmentDate || !appointmentTime || !symptoms) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Get doctor and department details
    const doctor = await User.findById(doctorId)
      .select('name doctor_info')
      .populate('doctor_info.department', 'name');

    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const department = await Department.findById(departmentId);
    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }

    // Validate appointment date and time
    const selectedDate = new Date(appointmentDate);
    selectedDate.setHours(0, 0, 0, 0);
    
    // Check if doctor is available on that date
    const schedule = await DoctorSchedule.findOne({
      doctor_id: doctorId,
      date: selectedDate
    });

    if (schedule && !schedule.is_available) {
      return res.status(400).json({ 
        message: `Doctor is not available on ${appointmentDate}. Reason: ${schedule.leave_reason || 'Not specified'}` 
      });
    }

    // Check if the time slot is within doctor's working hours
    let workingHours, breakTime;
    if (schedule) {
      workingHours = schedule.working_hours;
      breakTime = schedule.break_time;
    } else {
      workingHours = doctor.doctor_info?.default_working_hours || {
        start_time: '09:00',
        end_time: '17:00'
      };
      breakTime = doctor.doctor_info?.default_break_time || {
        start_time: '13:00',
        end_time: '14:00'
      };
    }

    // Validate if appointment time is within working hours
    const appointmentMinutes = parseTime(appointmentTime);
    const startMinutes = parseTime(workingHours.start_time);
    const endMinutes = parseTime(workingHours.end_time);
    const breakStartMinutes = parseTime(breakTime.start_time);
    const breakEndMinutes = parseTime(breakTime.end_time);

    if (appointmentMinutes < startMinutes || appointmentMinutes >= endMinutes) {
      return res.status(400).json({ 
        message: `Appointment time must be between ${workingHours.start_time} and ${workingHours.end_time}` 
      });
    }

    if (appointmentMinutes >= breakStartMinutes && appointmentMinutes < breakEndMinutes) {
      return res.status(400).json({ 
        message: `Appointment time cannot be during break time (${breakTime.start_time} - ${breakTime.end_time})` 
      });
    }

    // Check if slot is still available
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);
    
    const existingAppointment = await Token.findOne({
      doctor_id: doctorId,
      booking_date: { $gte: selectedDate, $lt: nextDay },
      time_slot: appointmentTime,
      status: { $nin: ['cancelled', 'missed'] }
    });

    if (existingAppointment) {
      return res.status(400).json({ message: 'This time slot is no longer available' });
    }

    // Validate family member if provided
    let familyMember = null;
    if (familyMemberId && familyMemberId !== 'self') {
      familyMember = await FamilyMember.findOne({
        _id: familyMemberId,
        patient_id: req.patient._id,
        isActive: true
      });

      if (!familyMember) {
        return res.status(404).json({ message: 'Family member not found' });
      }
    }

    // Check for patient/family member overlap (same patient or family member, same date)
    const overlapQuery = {
      patient_id: req.patient._id,
      booking_date: { $gte: selectedDate, $lt: nextDay },
      status: { $nin: ['cancelled', 'missed'] }
    };

    // If booking for family member, check if that family member already has appointment
    if (familyMember) {
      overlapQuery.family_member_id = familyMember._id;
    } else {
      // If booking for self, check if patient already has appointment for themselves
      overlapQuery.family_member_id = null;
    }

    const existingPatientAppointment = await Token.findOne(overlapQuery);

    if (existingPatientAppointment) {
      const forWhom = familyMember ? familyMember.name : 'you';
      return res.status(400).json({ 
        message: `${forWhom} already have an appointment on this date` 
      });
    }

    // Check daily token limit (if any)
    const dailyTokenCount = await Token.countDocuments({
      doctor_id: doctorId,
      booking_date: { $gte: selectedDate, $lt: nextDay },
      status: { $nin: ['cancelled', 'missed'] }
    });

    const maxDailyTokens = schedule?.max_patients_per_slot * 
      calculateTotalSlots(workingHours, breakTime, schedule?.slot_duration || 30) || 50;

    if (dailyTokenCount >= maxDailyTokens) {
      return res.status(400).json({ 
        message: 'Maximum daily appointments reached for this doctor' 
      });
    }

    // Generate token number
    const tokenNumber = `TKN${Date.now().toString().slice(-6)}`;

    // Create appointment token
    const appointmentToken = new Token({
      patient_id: req.patient._id,
      family_member_id: familyMember ? familyMember._id : null,
      doctor_id: doctorId,
      department: department.name,
      symptoms,
      booking_date: selectedDate,
      time_slot: appointmentTime,
      status: 'booked',
      token_number: tokenNumber,
      payment_status: 'pending',
      created_by: 'patient',
      estimated_wait_time: Math.floor(Math.random() * 30) + 15
    });

    await appointmentToken.save();

    // Update patient's booking history
    await User.findByIdAndUpdate(
      req.patient._id,
      { $push: { 'patient_info.booking_history': appointmentToken._id } }
    );

    res.status(201).json({
      message: 'Appointment booked successfully',
      appointment: {
        tokenNumber,
        doctorName: doctor.name,
        departmentName: department.name,
        appointmentDate,
        appointmentTime,
        patientName: familyMember ? familyMember.name : req.patient.name,
        isForFamilyMember: !!familyMember,
        familyMemberRelation: familyMember ? familyMember.relation : null,
        status: 'booked',
        estimatedWaitTime: appointmentToken.estimated_wait_time
      }
    });

  } catch (error) {
    console.error('Book appointment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient's appointments
router.get('/appointments', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const appointments = await Token.find({ patient_id: req.patient._id })
      .populate('doctor_id', 'name doctor_info')
      .sort({ booking_date: -1 });

    const appointmentList = appointments.map(apt => ({
      id: apt._id,
      tokenNumber: apt.token_number,
      doctorName: apt.doctor_id?.name || 'Unknown Doctor',
      departmentName: apt.department,
      appointmentDate: apt.booking_date,
      appointmentTime: apt.time_slot,
      symptoms: apt.symptoms,
      status: apt.status,
      estimatedWaitTime: apt.estimated_wait_time,
      paymentStatus: apt.payment_status,
      bookedAt: apt.createdAt
    }));

    res.json({ appointments: appointmentList });
  } catch (error) {
    console.error('Get patient appointments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== FAMILY MEMBER MANAGEMENT =====

// Get patient's family members
router.get('/family-members', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const familyMembers = await FamilyMember.find({ 
      patient_id: req.patient._id,
      isActive: true 
    }).sort({ createdAt: -1 });

    const memberList = familyMembers.map(member => ({
      id: member._id,
      name: member.name,
      age: member.age,
      gender: member.gender,
      relation: member.relation,
      phone: member.phone,
      allergies: member.allergies,
      medicalHistory: member.medical_history
    }));

    res.json({ familyMembers: memberList });
  } catch (error) {
    console.error('Get family members error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add a family member
router.post('/family-members', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { name, age, gender, relation, phone, allergies, medicalHistory } = req.body;

    // Validate required fields
    if (!name || !age || !gender || !relation) {
      return res.status(400).json({ message: 'Name, age, gender, and relation are required' });
    }

    // Check if family member with same name already exists for this patient
    const existingMember = await FamilyMember.findOne({
      patient_id: req.patient._id,
      name: name.trim(),
      isActive: true
    });

    if (existingMember) {
      return res.status(400).json({ message: 'Family member with this name already exists' });
    }

    const familyMember = new FamilyMember({
      patient_id: req.patient._id,
      name: name.trim(),
      age: parseInt(age),
      gender,
      relation,
      phone: phone || '',
      allergies: allergies || [],
      medical_history: medicalHistory || []
    });

    await familyMember.save();

    res.status(201).json({
      message: 'Family member added successfully',
      familyMember: {
        id: familyMember._id,
        name: familyMember.name,
        age: familyMember.age,
        gender: familyMember.gender,
        relation: familyMember.relation,
        phone: familyMember.phone
      }
    });
  } catch (error) {
    console.error('Add family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update a family member
router.put('/family-members/:memberId', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { memberId } = req.params;
    const { name, age, gender, relation, phone, allergies, medicalHistory } = req.body;

    const familyMember = await FamilyMember.findOne({
      _id: memberId,
      patient_id: req.patient._id,
      isActive: true
    });

    if (!familyMember) {
      return res.status(404).json({ message: 'Family member not found' });
    }

    // Update fields
    if (name) familyMember.name = name.trim();
    if (age) familyMember.age = parseInt(age);
    if (gender) familyMember.gender = gender;
    if (relation) familyMember.relation = relation;
    if (phone !== undefined) familyMember.phone = phone;
    if (allergies) familyMember.allergies = allergies;
    if (medicalHistory) familyMember.medical_history = medicalHistory;

    await familyMember.save();

    res.json({
      message: 'Family member updated successfully',
      familyMember: {
        id: familyMember._id,
        name: familyMember.name,
        age: familyMember.age,
        gender: familyMember.gender,
        relation: familyMember.relation,
        phone: familyMember.phone
      }
    });
  } catch (error) {
    console.error('Update family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a family member
router.delete('/family-members/:memberId', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { memberId } = req.params;

    const familyMember = await FamilyMember.findOne({
      _id: memberId,
      patient_id: req.patient._id,
      isActive: true
    });

    if (!familyMember) {
      return res.status(404).json({ message: 'Family member not found' });
    }

    // Soft delete
    familyMember.isActive = false;
    await familyMember.save();

    res.json({ message: 'Family member removed successfully' });
  } catch (error) {
    console.error('Delete family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
