const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { User, Token, Appointment } = require('../models/User');
const Department = require('../models/Department');
const FamilyMember = require('../models/FamilyMember');
const DoctorSchedule = require('../models/DoctorSchedule');
const { authMiddleware } = require('../middleware/authMiddleware');
const SymptomAnalysisService = require('../services/symptomAnalysisService');
const whatsappBotService = require('../services/whatsappBotService');
const notificationService = require('../services/notificationService');
const meetingLinkService = require('../services/meetingLinkService');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
let Razorpay; try { Razorpay = require('razorpay'); } catch { Razorpay = null; }

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../../uploads/profile-photos');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit as per requirements
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

// Analyze symptoms and suggest departments
router.post('/analyze-symptoms', async (req, res) => {
  try {
    const { symptoms } = req.body;

    if (!symptoms || typeof symptoms !== 'string') {
      return res.status(400).json({ message: 'Symptoms text is required' });
    }

    const analysis = await SymptomAnalysisService.analyzeSymptoms(symptoms);
    
    // Get department IDs from database for the suggested departments
    const suggestedDepartments = [analysis.primaryDepartment, ...analysis.relatedDepartments];
    const departments = await Department.find({ 
      name: { $in: suggestedDepartments },
      isActive: true 
    }).select('_id name description icon');

    // Create department mapping
    const departmentMap = {};
    departments.forEach(dept => {
      departmentMap[dept.name] = {
        id: dept._id,
        name: dept.name,
        description: dept.description,
        icon: dept.icon
      };
    });

    // Build response with department details
    const primaryDept = departmentMap[analysis.primaryDepartment];
    const relatedDepts = analysis.relatedDepartments
      .map(name => departmentMap[name])
      .filter(dept => dept); // Filter out departments not found in database

    res.json({
      analysis: {
        primaryDepartment: primaryDept,
        relatedDepartments: relatedDepts,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        matchedSymptoms: analysis.matchedSymptoms
      }
    });
  } catch (error) {
    console.error('Symptom analysis error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

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

// Get all doctors (public endpoint)
router.get('/doctors', async (req, res) => {
  try {
    const doctors = await User.find({ role: 'doctor' })
      .select('-password')
      .populate('doctor_info.department', 'name description')
      .sort({ createdAt: -1 });

    const doctorsWithInfo = doctors.map(doctor => ({
      _id: doctor._id,
      name: doctor.name,
      email: doctor.email,
      phone: doctor.phone,
      profile_photo: doctor.profile_photo,
      doctor_info: {
        department: doctor.doctor_info?.department,
        specialization: doctor.doctor_info?.specialization,
        experience_years: doctor.doctor_info?.experience_years,
        consultation_fee: doctor.doctor_info?.consultation_fee,
        qualifications: doctor.doctor_info?.qualifications,
        bio: doctor.doctor_info?.bio,
        default_working_hours: doctor.doctor_info?.default_working_hours,
        default_break_time: doctor.doctor_info?.default_break_time
      }
    }));

    res.json(doctorsWithInfo);
  } catch (error) {
    console.error('Get all doctors error:', error);
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
        // Check if doctor has any available schedules in the next 1 month
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const futureDate = new Date();
        futureDate.setMonth(today.getMonth() + 1);

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

// Get department-level available dates (union across doctors) for next 1 month
router.get('/departments/:departmentId/available-dates', async (req, res) => {
  try {
    const { departmentId } = req.params;

    // Find all doctors in the department
    const doctors = await User.find({
      role: 'doctor',
      'doctor_info.department': departmentId
    }).select('_id');


    if (!doctors.length) {
      return res.json({ availableDates: [] });
    }

    const doctorIds = doctors.map(d => d._id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const futureDate = new Date();
    futureDate.setMonth(today.getMonth() + 1);

    // Fetch all schedules for these doctors in next month
    const schedules = await DoctorSchedule.find({
      doctor_id: { $in: doctorIds },
      date: { $gte: today, $lte: futureDate },
      is_available: true
    }).sort({ date: 1 });


    // Helper: format date to local YYYY-MM-DD to avoid UTC day shifts
    const toLocalYMD = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Map dateStr -> aggregate available sessions (sum across doctors)
    const dateAvailabilityMap = new Map();

    for (const schedule of schedules) {
      const date = new Date(schedule.date);
      date.setHours(0, 0, 0, 0);
      const dateStr = toLocalYMD(date);

      const nextDay = new Date(date);
      nextDay.setDate(date.getDate() + 1);

      // Count existing appointments for this doctor/date
      const existingAppointments = await Token.countDocuments({
        doctor_id: schedule.doctor_id,
        booking_date: { $gte: date, $lt: nextDay },
        status: { $nin: ['cancelled', 'missed'] }
      });

      // Calculate session-based availability
      let availableSessions = 0;
      let totalSessions = 0;


      // Check morning session availability
      if (schedule.morning_session?.available !== false) {
        totalSessions++;
        const morningCapacity = schedule.morning_session?.max_patients || 10;
        const morningAppointments = await Token.countDocuments({
          doctor_id: schedule.doctor_id,
          booking_date: { $gte: date, $lt: nextDay },
          time_slot: { $gte: '09:00', $lt: '13:00' },
          status: { $nin: ['cancelled', 'missed'] }
        });
        if (morningAppointments < morningCapacity) {
          availableSessions++;
        }
      }

      // Check afternoon session availability
      if (schedule.afternoon_session?.available !== false) {
        totalSessions++;
        const afternoonCapacity = schedule.afternoon_session?.max_patients || 10;
        const afternoonAppointments = await Token.countDocuments({
          doctor_id: schedule.doctor_id,
          booking_date: { $gte: date, $lt: nextDay },
          time_slot: { $gte: '14:00', $lt: '18:00' },
          status: { $nin: ['cancelled', 'missed'] }
        });
        if (afternoonAppointments < afternoonCapacity) {
          availableSessions++;
        }
      }


      if (availableSessions > 0) {
        const prev = dateAvailabilityMap.get(dateStr) || { date, availableSessions: 0, totalSessions: 0 };
        prev.availableSessions += availableSessions;
        prev.totalSessions += totalSessions;
        dateAvailabilityMap.set(dateStr, prev);
      }
    }

    // If no schedules contributed availability, return empty list (no fabricated defaults)
    if (dateAvailabilityMap.size === 0) {
      return res.json({ availableDates: [] });
    }

    const availableDates = Array.from(dateAvailabilityMap.entries()).map(([dateStr, info]) => ({
      date: dateStr,
      dayName: info.date.toLocaleDateString('en-US', { weekday: 'long' }),
      isToday: dateStr === toLocalYMD(today),
      availableSessions: info.availableSessions || 0,
      totalSessions: info.totalSessions || 0,
      // Keep backward compatibility
      availableSlots: info.availableSessions || 0,
      totalSlots: info.totalSessions || 0
    })).sort((a, b) => (a.date < b.date ? -1 : 1));

    res.json({ availableDates });
  } catch (error) {
    console.error('Department available dates error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get department-level available sessions for a specific date (Morning/Afternoon)
router.get('/departments/:departmentId/availability/:date', async (req, res) => {
  try {
    const { departmentId, date } = req.params;

    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Doctors in department
    const doctors = await User.find({
      role: 'doctor',
      'doctor_info.department': departmentId
    }).select('_id name doctor_info');

    if (!doctors.length) return res.json({ sessions: [] });

    // Define session times
    const sessions = [
      {
        id: 'morning',
        name: 'Morning Session',
        startTime: '09:00',
        endTime: '13:00',
        displayTime: '9:00 AM - 1:00 PM'
      },
      {
        id: 'afternoon',
        name: 'Afternoon Session',
        startTime: '14:00',
        endTime: '18:00',
        displayTime: '2:00 PM - 6:00 PM'
      }
    ];

    const availableSessions = [];

    for (const session of sessions) {
      const availableDoctors = [];


      for (const doctor of doctors) {
        // Check if doctor is available during this session
        const isAvailable = await checkDoctorSessionAvailability(
          doctor._id,
          selectedDate,
          session.startTime,
          session.endTime
        );


        if (isAvailable) {
          // Get real-time availability data for this doctor
          const doctorAvailability = await getDoctorSessionAvailability(
            doctor._id,
            selectedDate,
            session.startTime,
            session.endTime
          );

          availableDoctors.push({
            id: doctor._id,
            name: doctor.name,
            specialization: doctor.doctor_info?.specialization || 'General',
            experience: doctor.doctor_info?.experience || 0,
            fee: doctor.doctor_info?.consultation_fee || 500,
            ...doctorAvailability
          });
        }
      }


      if (availableDoctors.length > 0) {
        availableSessions.push({
          ...session,
          availableDoctors,
          doctorCount: availableDoctors.length
        });
      }
    }

    res.json({ sessions: availableSessions });
  } catch (error) {
    console.error('Department availability error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to check if doctor is available during a session
async function checkDoctorSessionAvailability(doctorId, date, startTime, endTime) {
  try {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);

    // Check doctor's schedule for this date
    const schedule = await DoctorSchedule.findOne({
      doctor_id: doctorId,
      date: { $gte: date, $lt: nextDay },
      is_available: true
    });

    // If no schedule for this date, doctor is not available
    if (!schedule) return false;

    // Check session-based availability first
    if (startTime >= '09:00' && endTime <= '13:00') {
      // Morning session
      return schedule.morning_session?.available !== false;
    } else if (startTime >= '14:00' && endTime <= '18:00') {
      // Afternoon session
      return schedule.afternoon_session?.available !== false;
    }

    // Otherwise ensure within working hours
    const scheduleStart = schedule.working_hours?.start_time || '09:00';
    const scheduleEnd = schedule.working_hours?.end_time || '17:00';
    return startTime >= scheduleStart && endTime <= scheduleEnd;
  } catch (error) {
    console.error('Error checking doctor session availability:', error);
    return false;
  }
}

// Get detailed doctor session availability with queue information
async function getDoctorSessionAvailability(doctorId, date, startTime, endTime) {
  try {
    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Get doctor's schedule for this date
    const schedule = await DoctorSchedule.findOne({
      doctor_id: doctorId,
      date: { $gte: selectedDate, $lt: nextDay },
      is_available: true
    });

    // Count current appointments in this session
    const currentAppointments = await Token.countDocuments({
      doctor_id: doctorId,
        booking_date: { $gte: selectedDate, $lt: nextDay },
      time_slot: { $gte: startTime, $lt: endTime },
      status: { $nin: ['cancelled', 'missed', 'completed'] }
    });

    // Get session capacity
    let maxPatients = 10; // default
    if (schedule) {
      if (startTime >= '09:00' && endTime <= '13:00') {
        maxPatients = schedule.morning_session?.max_patients || 10;
      } else if (startTime >= '14:00' && endTime <= '18:00') {
        maxPatients = schedule.afternoon_session?.max_patients || 10;
      }
    }

    // Calculate next available slot
    const nextSlot = calculateNextAvailableSlot(selectedDate, startTime, endTime, currentAppointments);

    // Calculate average wait time (simplified - can be enhanced with ML)
    const averageWaitTime = Math.max(15, currentAppointments * 20); // 20 mins per patient, minimum 15 mins

    // Check if doctor has a schedule for this session
    let hasSchedule = false;
    if (!schedule) {
      hasSchedule = false;
    } else if (startTime >= '09:00' && endTime <= '13:00') {
      hasSchedule = schedule.morning_session?.available !== false;
    } else if (startTime >= '14:00' && endTime <= '18:00') {
      hasSchedule = schedule.afternoon_session?.available !== false;
    } else {
      hasSchedule = true; // For other times, use working hours
    }

    return {
      isAvailable: hasSchedule,
      patientsAhead: currentAppointments,
      maxPatients,
      nextSlot,
      averageWaitTime,
      sessionTime: `${startTime} - ${endTime}`,
      availableSlots: maxPatients - currentAppointments,
      hasAvailableSlots: currentAppointments < maxPatients
    };
  } catch (error) {
    console.error('Error getting doctor session availability:', error);
    return {
      isAvailable: false,
      patientsAhead: 0,
      maxPatients: 10,
      nextSlot: startTime,
      averageWaitTime: 15,
      sessionTime: `${startTime} - ${endTime}`,
      availableSlots: 0
    };
  }
}

// Calculate next available slot
function calculateNextAvailableSlot(date, startTime, endTime, currentAppointments) {
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  const slotDuration = 45; // 45 minutes per slot
  
  const nextSlotMinutes = startMinutes + (currentAppointments * slotDuration);
  
  if (nextSlotMinutes >= endMinutes) {
    return 'Fully Booked';
  }
  
  const nextHour = Math.floor(nextSlotMinutes / 60);
  const nextMin = nextSlotMinutes % 60;
  
  const nextSlot = new Date(date);
  nextSlot.setHours(nextHour, nextMin, 0, 0);
  
  return nextSlot.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
}

// Auto-assign doctor based on load balancing
router.post('/departments/:departmentId/auto-assign', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { departmentId } = req.params;
    const { date, sessionId, familyMemberId } = req.body;

    if (!date || !sessionId) {
      return res.status(400).json({ message: 'date and sessionId are required' });
    }

    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Get session details
    const sessions = [
      { id: 'morning', startTime: '09:00', endTime: '13:00' },
      { id: 'afternoon', startTime: '14:00', endTime: '18:00' }
    ];
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      return res.status(400).json({ message: 'Invalid session' });
    }

    // Get available doctors for this session
    const doctors = await User.find({
      role: 'doctor',
      'doctor_info.department': departmentId
    }).select('_id name doctor_info');

    const availableDoctors = [];
    for (const doctor of doctors) {
      const isAvailable = await checkDoctorSessionAvailability(
        doctor._id,
        selectedDate,
        session.startTime,
        session.endTime
      );
      if (isAvailable) {
        // Calculate current load for this doctor on this date
        const currentLoad = await Token.countDocuments({
          doctor_id: doctor._id,
          booking_date: { $gte: selectedDate, $lt: nextDay },
          status: { $in: ['booked', 'in_queue'] }
        });

        availableDoctors.push({
          id: doctor._id,
          name: doctor.name,
          specialization: doctor.doctor_info?.specialization || 'General',
          experience: doctor.doctor_info?.experience || 0,
          fee: doctor.doctor_info?.consultation_fee || 500,
          currentLoad
        });
      }
    }

    if (availableDoctors.length === 0) {
      return res.status(400).json({ message: 'No doctors available for this session' });
    }

    // Sort by load (ascending) and select the doctor with least load
    const sortedDoctors = availableDoctors.sort((a, b) => a.currentLoad - b.currentLoad);
    const assignedDoctor = sortedDoctors[0];

    res.json({
      assignedDoctor,
      reason: `Auto-assigned to Dr. ${assignedDoctor.name} (${assignedDoctor.currentLoad} patients in queue)`,
      alternativeDoctors: sortedDoctors.slice(1, 4) // Show next 3 options
    });
  } catch (error) {
    console.error('Auto-assign doctor error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get doctors available for a department on a specific date/time
router.get('/departments/:departmentId/available-doctors', async (req, res) => {
  try {
    const { departmentId } = req.params;
    const { date, time } = req.query;

    if (!date || !time) return res.status(400).json({ message: 'date and time are required' });

    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Doctors in department
    const doctors = await User.find({
      role: 'doctor',
      'doctor_info.department': departmentId
    }).select('name doctor_info email profile_photo');

    // Filter to those with schedule and free at time, and consider session capacity
    const available = [];
    for (const doctor of doctors) {
      // Require explicit schedule on the selected date
      console.log('[AVAIL-DOCTORS] doctorId=', doctor._id.toString(), 'date=', date, 'time=', time, 'range=', selectedDate.toISOString(), 'to', nextDay.toISOString());
      const schedule = await DoctorSchedule.findOne({
        doctor_id: doctor._id,
        date: { $gte: selectedDate, $lt: nextDay },
        is_available: true
      });
      if (!schedule) {
        console.log('[AVAIL-DOCTORS] No schedule found in range for doctor');
        continue;
      }

      const workingHours = schedule.working_hours;
      const breakTime = schedule.break_time;

      // Check time in working hours and not during break
      const t = parseTime(time);
      const start = parseTime(workingHours.start_time);
      const end = parseTime(workingHours.end_time);
      const bs = parseTime(breakTime.start_time);
      const be = parseTime(breakTime.end_time);
      const within = t >= start && t < end && !(t >= bs && t < be);
      if (!within) continue;

      // Ensure time falls in an available session if within session windows
      const inMorning = t >= parseTime('09:00') && t < parseTime('13:00');
      const inAfternoon = t >= parseTime('14:00') && t < parseTime('18:00');
      if (inMorning && schedule.morning_session?.available === false) continue;
      if (inAfternoon && schedule.afternoon_session?.available === false) continue;

      const conflict = await Token.findOne({
        doctor_id: doctor._id,
        booking_date: { $gte: selectedDate, $lt: nextDay },
        time_slot: time,
        status: { $nin: ['cancelled', 'missed'] }
      });
      if (conflict) continue;

      // Check session capacity against current bookings in the session window
      let sessionStart = workingHours.start_time;
      let sessionEnd = workingHours.end_time;
      let maxPatients = 10;
      if (inMorning) {
        sessionStart = '09:00';
        sessionEnd = '13:00';
        maxPatients = schedule.morning_session?.max_patients || 10;
      } else if (inAfternoon) {
        sessionStart = '14:00';
        sessionEnd = '18:00';
        maxPatients = schedule.afternoon_session?.max_patients || 10;
      }

      const currentAppointments = await Token.countDocuments({
        doctor_id: doctor._id,
        booking_date: { $gte: selectedDate, $lt: nextDay },
        time_slot: { $gte: sessionStart, $lt: sessionEnd },
        status: { $nin: ['cancelled', 'missed', 'completed'] }
      });
      const hasCapacity = currentAppointments < maxPatients;
      if (!hasCapacity) continue;

      available.push({
        id: doctor._id,
        name: doctor.name,
        email: doctor.email,
        specialization: doctor.doctor_info?.specialization || 'General Medicine',
        departmentId,
        experience: doctor.doctor_info?.experience_years || 0,
        fee: doctor.doctor_info?.consultation_fee || 500,
        profilePhoto: doctor.profile_photo,
        rating: 4.5,
        reviews: 50,
        isAvailable: true,
        hasAvailableSlots: true,
        availableDays: 1,
        nextAvailableDate: date
      });
    }

    res.json({ doctors: available });
  } catch (error) {
    console.error('Department available doctors error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== PAYMENTS (Razorpay - test/dummy) =====
router.get('/payment/key', authMiddleware, async (req, res) => {
  try {
    const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy_key';
    res.json({ keyId, dummy: !process.env.RAZORPAY_KEY_ID });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/payment/create-order', authMiddleware, async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt } = req.body;
    if (!amount) return res.status(400).json({ message: 'amount is required' });

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    // If real keys are present and SDK is available, create a live test order
    if (keyId && keySecret && Razorpay) {
      const instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
      const order = await instance.orders.create({
        amount: Math.round(Number(amount) * 100),
        currency,
        receipt: receipt || `rcpt_${Date.now()}`
      });
      return res.json({ order, dummy: false });
    }

    // Dummy fallback (no keys): simulate an order
    const order = {
      id: `order_dummy_${Date.now()}`,
      amount: Math.round(Number(amount) * 100),
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
      status: 'created',
      created_at: Math.floor(Date.now() / 1000)
    };
    return res.json({ order, dummy: true });
  } catch (error) {
    console.error('Razorpay create order error:', error);
    res.status(500).json({ message: 'Failed to create payment order' });
  }
});

// Mark an appointment as paid (dummy verification)
router.post('/payment/mark-paid', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { appointmentId, amount, method = 'card', reference } = req.body;
    if (!appointmentId) return res.status(400).json({ message: 'appointmentId is required' });

    const appointment = await Token.findOne({ _id: appointmentId, patient_id: req.patient._id });
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    await Token.findByIdAndUpdate(appointmentId, {
      $set: {
        payment_status: 'paid',
        paid_amount: amount || appointment.paid_amount || (appointment.doctor_id?.doctor_info?.consultation_fee || 500),
        payment_method: method,
        payment_reference: reference || `PAY${Date.now().toString().slice(-8)}`
      }
    });

    return res.json({ message: 'Payment marked as paid', status: 'paid' });
  } catch (error) {
    console.error('Mark paid error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get available dates for a doctor (only scheduled dates, next 1 month)
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
    futureDate.setMonth(today.getMonth() + 1); // 1 month ahead

    // Get all the doctor's actual schedules for the next month
    const schedules = await DoctorSchedule.find({
      doctor_id: doctorId,
      date: { $gte: today, $lte: futureDate }
    }).sort({ date: 1 });

    const availableDates = [];

    // Process each scheduled date
    for (const schedule of schedules) {
      // Only process available schedules
      if (!schedule.is_available) {
        continue;
      }

      const checkDate = schedule.date;
      const dateStr = checkDate.toISOString().split('T')[0];

      // Check if there are any available slots for this date
      const nextDay = new Date(checkDate);
      nextDay.setDate(checkDate.getDate() + 1);

      const existingAppointments = await Token.countDocuments({
        doctor_id: doctorId,
        booking_date: { $gte: checkDate, $lt: nextDay },
        status: { $nin: ['cancelled', 'missed'] }
      });

      // Calculate total possible slots
      const totalSlots = calculateTotalSlots(schedule.working_hours, schedule.break_time, schedule.slot_duration || 30);
      const availableSlots = totalSlots - existingAppointments;

      if (availableSlots > 0) {
        availableDates.push({
          date: dateStr,
          dayName: checkDate.toLocaleDateString('en-US', { weekday: 'long' }),
          isToday: dateStr === today.toISOString().split('T')[0],
          workingHours: {
            start: schedule.working_hours.start_time,
            end: schedule.working_hours.end_time
          },
          breakTime: {
            start: schedule.break_time.start_time,
            end: schedule.break_time.end_time
          },
          availableSlots,
          totalSlots
        });
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
    
    // Get doctor's schedule for this date (match by day range)
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);
    console.log('[SLOTS] doctorId=', doctorId, 'dateParam=', date, 'selectedDateISO=', selectedDate.toISOString(), 'range=', selectedDate.toISOString(), 'to', nextDay.toISOString());
    const schedule = await DoctorSchedule.findOne({
      doctor_id: doctorId,
      date: { $gte: selectedDate, $lt: nextDay }
    });
    if (!schedule) {
      console.log('[SLOTS] No schedule found for range.');
    } else {
      console.log('[SLOTS] Found schedule id=', schedule._id.toString(), 'dateISO=', new Date(schedule.date).toISOString(), 'is_available=', schedule.is_available);
    }

    // Only use schedule if exists, otherwise doctor is not available
    if (!schedule) {
      return res.json({ 
        slots: [], 
        message: `Doctor has no schedule for ${date}. Please select a scheduled date.`,
        isAvailable: false,
        leaveReason: 'No schedule'
      });
    }
    
    if (!schedule.is_available) {
      return res.json({ 
        slots: [], 
        message: `Doctor is not available on ${date}. Reason: ${schedule.leave_reason || 'Not specified'}`,
        isAvailable: false,
        leaveReason: schedule.leave_reason
      });
    }
    
    const workingHours = schedule.working_hours;
    const breakTime = schedule.break_time;
    const slotDuration = schedule.slot_duration || 30;

    // Generate time slots
    const slots = generateTimeSlots(workingHours, breakTime, slotDuration);

    // Get existing appointments for this date (use same nextDay calculated above)

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

// Check for patient appointment conflict on a date (optionally for a specific doctor)
router.get('/appointments/conflict', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { date, doctorId, familyMemberId } = req.query;
    if (!date) {
      return res.status(400).json({ message: 'date is required' });
    }

    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const query = {
      patient_id: req.patient._id,
      booking_date: { $gte: selectedDate, $lt: nextDay },
      status: { $nin: ['cancelled', 'missed'] }
    };
    // Only consider the same person: either self (null) or the specific family member
    if (familyMemberId && familyMemberId !== 'self' && familyMemberId !== 'undefined') {
      query.family_member_id = familyMemberId;
    } else {
      query.family_member_id = null;
    }
    if (doctorId) {
      query.doctor_id = doctorId;
    }

    const existing = await Token.findOne(query).populate('doctor_id', 'name');
    if (existing) {
      return res.json({
        conflict: true,
        message: `This person already has an appointment on this date${doctorId ? ' with this doctor' : ''}.`,
        doctorName: existing.doctor_id?.name || null,
        timeSlot: existing.time_slot
      });
    }

    res.json({ conflict: false });
  } catch (error) {
    console.error('Conflict check error:', error);
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
      familyMemberId,
      appointmentType = 'in-person' // Default to in-person if not specified
    } = req.body;

    // Validate required fields
    if (!doctorId || !departmentId || !appointmentDate || !appointmentTime) {
      return res.status(400).json({ message: 'doctorId, departmentId, appointmentDate and appointmentTime are required' });
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
    // Parse appointmentDate safely as local date (YYYY-MM-DD)
    const parts = String(appointmentDate).split('-').map(Number);
    const selectedDate = (parts.length === 3 && parts.every(n => !Number.isNaN(n)))
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : new Date(appointmentDate);
    selectedDate.setHours(0, 0, 0, 0);
    
    // Check if doctor is available on that date (match by day range to avoid timezone issues)
    const endOfDay = new Date(selectedDate);
    endOfDay.setDate(endOfDay.getDate() + 1);
    console.log('[BOOK] doctorId=', doctorId, 'appointmentDate=', appointmentDate, 'selectedDateISO=', selectedDate.toISOString(), 'range=', selectedDate.toISOString(), 'to', endOfDay.toISOString());
    const schedule = await DoctorSchedule.findOne({
      doctor_id: doctorId,
      date: { $gte: selectedDate, $lt: endOfDay }
    });
    if (!schedule) {
      console.log('[BOOK] No schedule found for range.');
    } else {
      console.log('[BOOK] Found schedule id=', schedule._id.toString(), 'dateISO=', new Date(schedule.date).toISOString(), 'is_available=', schedule.is_available);
    }

    // If explicit schedule exists and is unavailable, block booking. Otherwise, allow using defaults
    if (schedule && !schedule.is_available) {
      return res.status(400).json({ 
        message: `Doctor is not available on ${appointmentDate}. Reason: ${schedule.leave_reason || 'Not specified'}` 
      });
    }

    // Validate session-based availability
    const appointmentMinutes = parseTime(appointmentTime || '');
    if (!Number.isFinite(appointmentMinutes)) {
      return res.status(400).json({ message: 'Invalid appointment time' });
    }
    let isSessionValid = false;
    let sessionName = '';

    // Check morning session (9:00 AM - 1:00 PM)
    if (appointmentMinutes >= parseTime('09:00') && appointmentMinutes < parseTime('13:00')) {
      if (schedule) {
        isSessionValid = schedule.morning_session?.available !== false;
      } else {
        isSessionValid = true; // Default available if no schedule
      }
      sessionName = 'Morning Session';
    }
    // Check afternoon session (2:00 PM - 6:00 PM)
    else if (appointmentMinutes >= parseTime('14:00') && appointmentMinutes < parseTime('18:00')) {
      if (schedule) {
        isSessionValid = schedule.afternoon_session?.available !== false;
      } else {
        isSessionValid = true; // Default available if no schedule
      }
      sessionName = 'Afternoon Session';
    }
    // Fallback to working hours for other times
    else {
      const workingHours = schedule?.working_hours || doctor.doctor_info?.default_working_hours || { start_time: '09:00', end_time: '17:00' };
    const startMinutes = parseTime(workingHours.start_time);
    const endMinutes = parseTime(workingHours.end_time);
      isSessionValid = appointmentMinutes >= startMinutes && appointmentMinutes < endMinutes;
      sessionName = 'Working Hours';
    }

    if (!isSessionValid) {
      return res.status(400).json({ 
        message: `Doctor is not available during ${sessionName} on ${appointmentDate}` 
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

    // Block multiple active appointments in the same department (for self or same family member)
    const activeSameDepartmentQuery = {
      patient_id: req.patient._id,
      department: department.name,
      status: { $in: ['booked', 'in_queue'] }
    };
    if (familyMember) {
      activeSameDepartmentQuery.family_member_id = familyMember._id;
    } else {
      activeSameDepartmentQuery.family_member_id = null;
    }

    const existingActiveSameDept = await Token.findOne(activeSameDepartmentQuery);
    if (existingActiveSameDept) {
      const forWhom = familyMember ? familyMember.name : 'you';
      return res.status(400).json({
        message: `Cannot book another appointment in the same department until the current one for ${forWhom} is completed or cancelled`
      });
    }

    // Check for overlap for the SAME doctor only (allow different doctors on same date)
    const overlapQuery = {
      patient_id: req.patient._id,
      booking_date: { $gte: selectedDate, $lt: nextDay },
      doctor_id: doctorId,
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
        message: `${forWhom} already have an appointment with this doctor on this date` 
      });
    }

    // Check daily token limit (if any)
    const dailyTokenCount = await Token.countDocuments({
      doctor_id: doctorId,
      booking_date: { $gte: selectedDate, $lt: nextDay },
      status: { $nin: ['cancelled', 'missed'] }
    });

    // Derive working hours and break time from schedule or doctor defaults
    const workingHours = schedule?.working_hours || doctor.doctor_info?.default_working_hours || { start_time: '09:00', end_time: '17:00' };
    const breakTime = schedule?.break_time || doctor.doctor_info?.default_break_time || { start_time: '13:00', end_time: '14:00' };
    const slotDuration = schedule?.slot_duration || 30;

    const perSlotMax = schedule?.max_patients_per_slot || 1;
    const totalSlotsForDay = calculateTotalSlots(workingHours, breakTime, slotDuration);
    const maxDailyTokens = (perSlotMax * totalSlotsForDay) || 50;

    if (dailyTokenCount >= maxDailyTokens) {
      return res.status(400).json({ 
        message: 'Maximum daily appointments reached for this doctor' 
      });
    }

    // Generate token number
    const tokenNumber = `T${Date.now().toString().slice(-4)}`;

    // Determine session type and time range
    let sessionType = 'morning';
    let sessionTimeRange = '9:00 AM - 1:00 PM';
    
    if (appointmentMinutes >= parseTime('09:00') && appointmentMinutes < parseTime('13:00')) {
      sessionType = 'morning';
      sessionTimeRange = '9:00 AM - 1:00 PM';
    } else if (appointmentMinutes >= parseTime('14:00') && appointmentMinutes < parseTime('18:00')) {
      sessionType = 'afternoon';
      sessionTimeRange = '2:00 PM - 6:00 PM';
    } else {
      sessionType = 'evening';
      sessionTimeRange = '6:00 PM - 9:00 PM';
    }

    // Generate meeting link for video consultations
    let meetingLinkData = null;
    if (appointmentType === 'video') {
      try {
        const tempAppointmentId = new mongoose.Types.ObjectId();
        meetingLinkData = meetingLinkService.generateMeetingLink(
          tempAppointmentId.toString(),
          doctorId,
          req.patient._id,
          appointmentDate,
          appointmentTime,
          'jitsi' // Default to Jitsi, can be made configurable
        );
        console.log('Generated meeting link for video consultation:', meetingLinkData);
      } catch (error) {
        console.error('Error generating meeting link:', error);
        // Continue with booking even if meeting link generation fails
      }
    }

    // Create appointment token
    const appointmentToken = new Token({
      patient_id: req.patient._id,
      family_member_id: familyMember ? familyMember._id : null,
      doctor_id: doctorId,
      department: department.name,
      symptoms: symptoms && String(symptoms).trim().length > 0 ? symptoms : 'Not provided',
      booking_date: selectedDate,
      time_slot: appointmentTime,
      session_type: sessionType,
      session_time_range: sessionTimeRange,
      appointment_type: appointmentType, // Add appointment type
      meeting_link: meetingLinkData ? {
        meetingId: meetingLinkData.meetingId,
        meetingUrl: meetingLinkData.meetingUrl,
        meetingPassword: meetingLinkData.meetingPassword,
        provider: meetingLinkData.provider,
        expiresAt: meetingLinkData.expiresAt,
        isActive: meetingLinkData.isActive
      } : undefined,
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

    // Send comprehensive notifications (email, SMS, WhatsApp) - async, don't wait for it
    console.log('🔔 Sending booking confirmation notifications for appointment:', appointmentToken._id);
    console.log('📧 Patient email:', req.patient.email);
    console.log('📱 Patient phone:', req.patient.phone);
    
    notificationService.sendBookingConfirmation(appointmentToken._id).then(result => {
      console.log('✅ Booking confirmation notifications sent successfully:', result);
    }).catch(error => {
      console.error('❌ Failed to send booking confirmation notifications:', error);
    });

    // Prepare response data
    const responseData = {
      message: 'Appointment booked successfully',
      appointment: {
        id: appointmentToken._id,
        tokenNumber,
        doctorName: doctor.name,
        departmentName: department.name,
        appointmentDate,
        appointmentTime,
        appointmentType,
        paymentStatus: 'pending',
        patientName: familyMember ? familyMember.name : req.patient.name,
        isForFamilyMember: !!familyMember,
        familyMemberRelation: familyMember ? familyMember.relation : null,
        status: 'booked',
        estimatedWaitTime: appointmentToken.estimated_wait_time
      }
    };

    // Add meeting link information for video consultations
    if (appointmentType === 'video' && meetingLinkData) {
      responseData.appointment.meetingLink = {
        meetingUrl: meetingLinkData.meetingUrl,
        meetingId: meetingLinkData.meetingId,
        meetingPassword: meetingLinkData.meetingPassword,
        provider: meetingLinkData.provider,
        expiresAt: meetingLinkData.expiresAt,
        instructions: meetingLinkService.generateMeetingInstructions(
          meetingLinkData,
          familyMember ? familyMember.name : req.patient.name,
          doctor.name,
          appointmentDate,
          appointmentTime
        )
      };
    }

    res.status(201).json(responseData);

  } catch (error) {
    console.error('Book appointment error:', error && error.stack ? error.stack : error);
    // Return more detail in development to aid debugging
    const payload = { message: 'Server error' };
    if (process.env.NODE_ENV !== 'production') {
      payload.error = error?.message || String(error);
    }
    res.status(500).json(payload);
  }
});

// Get patient's appointments with enhanced details
router.get('/appointments', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { familyMemberId, status } = req.query;
    
    // Build query
    let query = { patient_id: req.patient._id };
    if (familyMemberId) {
      if (familyMemberId === 'self') {
        query.family_member_id = null; // self means appointments not for a family member
      } else {
        query.family_member_id = familyMemberId;
      }
    }
    if (status) {
      query.status = status;
    }

    const appointments = await Token.find(query)
      .populate('doctor_id', 'name doctor_info')
      .populate('family_member_id', 'name relation patientId')
      .populate('patient_id', 'name patientId')
      .sort({ booking_date: -1 });

    const appointmentList = appointments.map(apt => {
      // Determine session type and time range
      const timeSlot = apt.time_slot || apt.session_time_range || '09:00';
      const sessionType = apt.session_type || (timeSlot >= '09:00' && timeSlot < '13:00' ? 'morning' : 
                                               timeSlot >= '14:00' && timeSlot < '18:00' ? 'afternoon' : 'evening');
      const sessionTimeRange = apt.session_time_range || (sessionType === 'morning' ? '9:00 AM - 1:00 PM' :
                                                          sessionType === 'afternoon' ? '2:00 PM - 6:00 PM' : '6:00 PM - 9:00 PM');

      return {
      id: apt._id,
      doctorId: apt.doctor_id?._id,
      tokenNumber: apt.token_number,
      doctorName: apt.doctor_id?.name || 'Unknown Doctor',
      departmentName: apt.department,
      appointmentDate: apt.booking_date,
      appointmentTime: apt.time_slot,
        sessionType: sessionType,
        sessionTimeRange: sessionTimeRange,
      symptoms: apt.symptoms,
      status: apt.status,
      estimatedWaitTime: apt.estimated_wait_time,
      paymentStatus: apt.payment_status,
      bookedAt: apt.createdAt,
        consultationCompletedAt: apt.consultation_completed_at,
      isFamilyMember: !!apt.family_member_id,
      patientName: apt.family_member_id ? apt.family_member_id.name : (apt.patient_id?.name || 'You'),
      patientCode: apt.family_member_id ? apt.family_member_id.patientId : (apt.patient_id?.patientId || null),
        familyMemberRelation: apt.family_member_id ? apt.family_member_id.relation : null,
        consultationNotes: apt.consultation_notes,
        diagnosis: apt.diagnosis,
        prescriptions: apt.prescriptions || [],
        cancellationReason: apt.cancellation_reason,
        // Video consultation fields
        appointmentType: apt.appointment_type || 'in-person',
        meetingLink: apt.meeting_link ? {
          meetingUrl: apt.meeting_link.meetingUrl,
          meetingId: apt.meeting_link.meetingId,
          meetingPassword: apt.meeting_link.meetingPassword,
          provider: apt.meeting_link.provider,
          expiresAt: apt.meeting_link.expiresAt
        } : null
      };
    });

    res.json({ appointments: appointmentList });
  } catch (error) {
    console.error('Get patient appointments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get family members for filtering appointments (legacy endpoint - keeping for backward compatibility)
router.get('/family-members-filter', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const familyMembers = await FamilyMember.find({ patient_id: req.patient._id, isActive: true })
      .select('_id name relation patientId')
      .sort({ name: 1 });

    const familyList = [
      { _id: null, name: 'Myself', relation: 'self', patientId: req.patient.patientId },
      ...familyMembers.map(member => ({
        _id: member._id,
        name: member.name,
        relation: member.relation,
        patientId: member.patientId
      }))
    ];

    res.json({ familyMembers: familyList });
  } catch (error) {
    console.error('Get family members error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single appointment by id (for reschedule prefill)
router.get('/appointments/:appointmentId', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const apt = await Token.findById(appointmentId)
      .populate('doctor_id', 'name email doctor_info')
      .populate('patient_id', 'name email');
    if (!apt) {
      return res.status(404).json({ message: 'Appointment not found' });
    }
    if (apt.patient_id._id.toString() !== req.patient._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const dept = await Department.findOne({ name: apt.department }).select('_id name');
    res.json({
      appointment: {
        id: apt._id,
        doctorId: apt.doctor_id?._id,
        doctorName: apt.doctor_id?.name,
        doctorEmail: apt.doctor_id?.email,
        departmentId: dept?._id || null,
        departmentName: apt.department,
        appointmentDate: apt.booking_date,
        appointmentTime: apt.time_slot,
        status: apt.status
      }
    });
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Cancel appointment with refund processing
router.post('/appointments/:appointmentId/cancel', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { reason, refundMethod = 'wallet' } = req.body;

    // Find the appointment
    const appointment = await Token.findById(appointmentId)
      .populate('patient_id', 'name email phone')
      .populate('doctor_id', 'name email phone doctor_info')
      .populate('family_member_id', 'name relation');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Verify ownership
    if (appointment.patient_id._id.toString() !== req.patient._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if already cancelled
    if (appointment.status === 'cancelled') {
      return res.status(400).json({ message: 'Appointment is already cancelled' });
    }

    // Check if consultation is completed
    if (appointment.status === 'consulted') {
      return res.status(400).json({ message: 'Cannot cancel completed consultation' });
    }

    // Determine cancellation policy
    const now = new Date();
    const appointmentDate = new Date(appointment.booking_date);
    const isBeforeConsultation = !appointment.consultation_started_at;
    const isSameDay = appointmentDate.toDateString() === now.toDateString();
    
    // Check if consultation has started (same day and current time is past appointment time)
    const appointmentTime = appointment.time_slot;
    const currentTime = now.toTimeString().slice(0, 5);
    const hasConsultationStarted = isSameDay && currentTime >= appointmentTime;

    let refundEligible = false;
    let refundAmount = 0;
    let refundStatus = 'none';

    // Cancellation Policy Logic
    if (isBeforeConsultation && !hasConsultationStarted) {
      // Full refund allowed - consultation hasn't started
      refundEligible = true;
      refundAmount = appointment.doctor_id?.doctor_info?.consultation_fee || 500;
      refundStatus = 'pending';
    } else if (hasConsultationStarted || appointment.consultation_started_at) {
      // No refund - consultation has started
      refundEligible = false;
      refundAmount = 0;
      refundStatus = 'none';
    }

    // Update appointment status
    const updateData = {
      status: 'cancelled',
      cancelled_at: now,
      cancelled_by: 'patient',
      cancellation_reason: reason || 'Cancelled by patient'
    };

    // Add refund information if eligible
    if (refundEligible && appointment.payment_status === 'paid') {
      updateData.refund_status = refundStatus;
      updateData.refund_amount = refundAmount;
      updateData.refund_method = refundMethod;
      updateData.refund_reference = `REF${Date.now().toString().slice(-6)}`;
    }

    const updatedAppointment = await Token.findByIdAndUpdate(
      appointmentId,
      updateData,
      { new: true }
    );

    // Process refund if eligible
    let refundResult = null;
    if (refundEligible && appointment.payment_status === 'paid') {
      refundResult = await processRefund({
        appointmentId,
        amount: refundAmount,
        method: refundMethod,
        patientId: req.patient._id,
        reference: updateData.refund_reference
      });
      
      // Update refund status based on processing result
      if (refundResult.success) {
        await Token.findByIdAndUpdate(appointmentId, { 
          refund_status: 'processed',
          payment_status: 'refunded'
        });
      } else {
        await Token.findByIdAndUpdate(appointmentId, { 
          refund_status: 'failed'
        });
      }
    }

    // Send comprehensive cancellation notifications (email, SMS, WhatsApp) - async, don't wait for it
    const refundInfo = {
      eligible: refundEligible,
      amount: refundAmount,
      method: refundMethod,
      status: refundResult?.success ? 'processed' : 'failed'
    };
    
    notificationService.sendCancellationConfirmation(appointmentId, refundInfo).catch(error => {
      console.error('Failed to send cancellation confirmation notifications:', error);
    });

    // Prepare response
    const response = {
      message: 'Appointment cancelled successfully',
      appointment: {
        id: updatedAppointment._id,
        status: updatedAppointment.status,
        cancelledAt: updatedAppointment.cancelled_at,
        cancellationReason: updatedAppointment.cancellation_reason
      }
    };

    // Add refund information to response
    if (refundEligible) {
      response.refund = {
        eligible: true,
        amount: refundAmount,
        method: refundMethod,
        status: refundResult?.success ? 'processed' : 'failed',
        reference: updateData.refund_reference,
        message: refundResult?.success ? 
          `Refund of ₹${refundAmount} will be processed to your ${refundMethod} account` :
          'Refund processing failed. Please contact support.'
      };
    } else {
      response.refund = {
        eligible: false,
        reason: hasConsultationStarted ? 
          'No refund available - consultation has started' :
          'No payment made for this appointment'
      };
    }

    res.json(response);

  } catch (error) {
    console.error('Cancel appointment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Process refund
async function processRefund({ appointmentId, amount, method, patientId, reference }) {
  try {
    // Simulate refund processing based on method
    switch (method) {
      case 'wallet':
        // Add to patient's wallet balance
        await User.findByIdAndUpdate(patientId, {
          $inc: { 'patient_info.wallet_balance': amount }
        });
        return { success: true, message: 'Refund added to wallet' };
        
      case 'upi':
        // Simulate UPI refund (in real implementation, integrate with payment gateway)
        return { success: true, message: 'UPI refund initiated' };
        
      case 'card':
        // Simulate card refund (in real implementation, integrate with payment gateway)
        return { success: true, message: 'Card refund initiated' };
        
      case 'cash':
        // For cash payments, no automatic refund
        return { success: false, message: 'Cash refund to be processed manually' };
        
      default:
        return { success: false, message: 'Invalid refund method' };
    }
  } catch (error) {
    console.error('Refund processing error:', error);
    return { success: false, message: 'Refund processing failed' };
  }
}

// Send cancellation notifications
async function sendCancellationNotifications({ appointment, patient, doctor, familyMember, refundEligible, refundAmount, refundResult }) {
  try {
    const patientName = familyMember ? familyMember.name : patient.name;
    const relation = familyMember ? familyMember.relation : 'self';

    // Patient notification
    const patientMessage = `Your appointment with Dr. ${doctor.name} on ${new Date(appointment.booking_date).toLocaleDateString()} has been cancelled.${refundEligible ? ` Refund of ₹${refundAmount} will be processed.` : ''}`;
    
    // Doctor notification
    const doctorMessage = `Appointment cancelled: ${patientName} (${relation}) - ${new Date(appointment.booking_date).toLocaleDateString()} at ${appointment.time_slot}`;

    // In a real implementation, you would send these via email/SMS/push notifications
    console.log('Patient Notification:', patientMessage);
    console.log('Doctor Notification:', doctorMessage);
    
    // You can integrate with email service, SMS service, or push notification service here
    // await emailService.send(patient.email, 'Appointment Cancelled', patientMessage);
    // await smsService.send(patient.phone, patientMessage);
    // await notificationService.send(doctor._id, 'Appointment Cancelled', doctorMessage);

  } catch (error) {
    console.error('Notification sending error:', error);
  }
}

// Check if there is an active appointment in the same department for self or a family member
router.get('/appointments/active-department-check', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { departmentId, familyMemberId } = req.query;

    if (!departmentId) {
      return res.status(400).json({ message: 'departmentId is required' });
    }

    const department = await Department.findById(departmentId);
    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }

    let familyMember = null;
    if (familyMemberId && familyMemberId !== 'self' && familyMemberId !== 'undefined') {
      try {
        familyMember = await FamilyMember.findOne({
          _id: familyMemberId,
          patientId: req.patient._id,
          isActive: true
        });
        if (!familyMember) {
          return res.status(404).json({ message: 'Family member not found' });
        }
      } catch (error) {
        console.error('Family member lookup error:', error);
        return res.status(400).json({ message: 'Invalid family member ID' });
      }
    }

    const query = {
      patient_id: req.patient._id,
      department: department.name,
      status: { $in: ['booked', 'in_queue'] }
    };

    if (familyMember) {
      query.family_member_id = familyMember._id;
    } else {
      query.family_member_id = null;
    }

    const existing = await Token.findOne(query).populate('doctor_id', 'name');

    if (existing) {
      const who = familyMember ? familyMember.name : 'you';
      return res.json({
        conflict: true,
        message: `Cannot book another appointment in the same department until the current one for ${who} is completed or cancelled`
      });
    }

    return res.json({ conflict: false });
  } catch (error) {
    console.error('Active department check error:', error);
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
      patientId: member.patientId,
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
    console.log('Add family member request:', req.body);
    console.log('Patient ID:', req.patient._id);
    
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
        patientId: familyMember.patientId,
        name: familyMember.name,
        age: familyMember.age,
        gender: familyMember.gender,
        relation: familyMember.relation,
        phone: familyMember.phone
      }
    });
  } catch (error) {
    console.error('Add family member error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
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
        patientId: familyMember.patientId,
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

// ===== PATIENT APPOINTMENT ACTIONS =====

// (Removed duplicate simple cancel route; using advanced cancel with refund logic above)

// Reschedule appointment (change date/time if available)
router.post('/appointments/:id/reschedule', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { doctorId, newDate, newTime } = req.body;

    if (!doctorId || !newDate || !newTime) {
      return res.status(400).json({ message: 'doctorId, newDate and newTime are required' });
    }

    const appointment = await Token.findOne({ _id: id, patient_id: req.patient._id });
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    if (['cancelled', 'missed', 'consulted'].includes(appointment.status)) {
      return res.status(400).json({ message: `Cannot reschedule a ${appointment.status} appointment` });
    }

    const doctor = await User.findById(doctorId).select('doctor_info role');
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const selectedDate = new Date(newDate);
    selectedDate.setHours(0, 0, 0, 0);
    const schedule = await DoctorSchedule.findOne({ doctor_id: doctorId, date: selectedDate });

    if (!schedule) {
      return res.status(400).json({ message: `Doctor has no schedule for ${newDate}. Please select a scheduled date.` });
    }

    if (!schedule.is_available) {
      return res.status(400).json({ message: `Doctor is not available on ${newDate}. Reason: ${schedule.leave_reason || 'Not specified'}` });
    }

    const workingHours = schedule.working_hours;
    const breakTime = schedule.break_time;

    const timeMinutes = parseTime(newTime);
    const startMinutes = parseTime(workingHours.start_time);
    const endMinutes = parseTime(workingHours.end_time);
    const breakStart = parseTime(breakTime.start_time);
    const breakEnd = parseTime(breakTime.end_time);
    if (timeMinutes < startMinutes || timeMinutes >= endMinutes || (timeMinutes >= breakStart && timeMinutes < breakEnd)) {
      return res.status(400).json({ message: 'Selected time is outside working hours' });
    }

    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const conflict = await Token.findOne({
      doctor_id: doctorId,
      booking_date: { $gte: selectedDate, $lt: nextDay },
      time_slot: newTime,
      status: { $nin: ['cancelled', 'missed'] },
      _id: { $ne: appointment._id }
    });
    if (conflict) {
      return res.status(400).json({ message: 'Selected time slot is no longer available' });
    }

    // Generate new token number for rescheduled appointment
    const newTokenNumber = `T${Date.now().toString().slice(-4)}`;

    appointment.doctor_id = doctorId;
    appointment.booking_date = selectedDate;
    appointment.time_slot = newTime;
    appointment.status = 'booked';
    appointment.token_number = newTokenNumber;
    await appointment.save();

    // Notify patient & doctor via email (best-effort)
    try {
      const { transporter } = require('../config/email');
      const patientEmail = appointment.patient_id?.email;
      const doctorEmail = appointment.doctor_id?.email;
      const dateStr = new Date(selectedDate).toLocaleDateString();

      if (patientEmail) {
        transporter.sendMail({
          to: patientEmail,
          subject: 'Appointment Rescheduled',
          text: `Your appointment has been rescheduled to ${dateStr} at ${newTime}. Token: ${newTokenNumber}`
        }).catch(() => {});
      }
      if (doctorEmail) {
        transporter.sendMail({
          to: doctorEmail,
          subject: 'Patient Rescheduled Appointment',
          text: `A patient has rescheduled to ${dateStr} at ${newTime}. Token: ${newTokenNumber}`
        }).catch(() => {});
      }
    } catch {}

    res.json({ message: 'Appointment rescheduled successfully', tokenNumber: newTokenNumber });
  } catch (error) {
    console.error('Reschedule appointment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== DEV UTILITIES (seed test data) =====
// Seed a few test appointments and schedules for the logged-in patient
// Enabled only in development environment
router.post('/dev/seed-appointments', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ message: 'Seeding is only allowed in development mode' });
    }

    // Find any doctor and their department
    const doctor = await User.findOne({ role: 'doctor' }).populate('doctor_info.department', 'name');
    if (!doctor) {
      return res.status(400).json({ message: 'No doctors found. Please create a doctor first.' });
    }

    const departmentName = doctor.doctor_info?.department?.name || 'General';

    // Prepare two future dates (tomorrow and day after)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d1 = new Date(today); d1.setDate(today.getDate() + 1);
    const d2 = new Date(today); d2.setDate(today.getDate() + 2);

    // Ensure schedules exist for those dates for reschedule/availability logic
    const scheduleTemplates = [d1, d2].map(date => ({
      doctor_id: doctor._id,
      date,
      is_available: true,
      working_hours: { start_time: '09:00', end_time: '18:00' },
      break_time: { start_time: '13:00', end_time: '14:00' },
      slot_duration: 30,
      morning_session: { available: true, max_patients: 10 },
      afternoon_session: { available: true, max_patients: 10 }
    }));

    for (const tpl of scheduleTemplates) {
      const start = new Date(tpl.date); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const existing = await DoctorSchedule.findOne({ doctor_id: tpl.doctor_id, date: { $gte: start, $lt: end } });
      if (!existing) {
        await DoctorSchedule.create(tpl);
      }
    }

    // Create two test appointments (pending payment)
    const appointments = [];
    const items = [
      { booking_date: d1, time_slot: '10:00', session_type: 'morning', session_time_range: '9:00 AM - 1:00 PM' },
      { booking_date: d2, time_slot: '15:00', session_type: 'afternoon', session_time_range: '2:00 PM - 6:00 PM' }
    ];

    for (const item of items) {
      const tokenNumber = `T${Date.now().toString().slice(-4)}${Math.floor(Math.random()*90+10)}`;
      const tok = new Token({
        patient_id: req.patient._id,
        family_member_id: null,
        doctor_id: doctor._id,
        department: departmentName,
        symptoms: 'Test data - seeded',
        booking_date: item.booking_date,
        time_slot: item.time_slot,
        session_type: item.session_type,
        session_time_range: item.session_time_range,
        status: 'booked',
        token_number: tokenNumber,
        payment_status: 'pending',
        created_by: 'patient',
        estimated_wait_time: Math.floor(Math.random() * 30) + 15
      });
      await tok.save();
      appointments.push(tok);

      // Push to patient's booking history
      await User.findByIdAndUpdate(req.patient._id, { $push: { 'patient_info.booking_history': tok._id } });
    }

    res.status(201).json({
      message: 'Seeded test appointments successfully',
      count: appointments.length,
      appointments: appointments.map(a => ({
        id: a._id,
        tokenNumber: a.token_number,
        date: a.booking_date,
        time: a.time_slot,
        status: a.status,
        paymentStatus: a.payment_status
      }))
    });
  } catch (error) {
    console.error('Seed appointments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== ACCOUNT MANAGEMENT ROUTES =====

// Get patient profile
router.get('/profile', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.patient._id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update patient profile
router.put('/profile', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const {
      name,
      age,
      gender,
      phone,
      email,
      address,
      bloodGroup,
      allergies,
      chronicConditions,
      emergencyContact
    } = req.body;

    const updateData = {
      name,
      age,
      gender,
      phone,
      email,
      address,
      bloodGroup,
      allergies,
      chronicConditions,
      emergencyContact
    };

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.patient._id,
      { $set: updateData },
      { new: true, select: '-password' }
    );

    res.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Upload profile photo
router.post('/upload-photo', authMiddleware, patientMiddleware, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No photo uploaded' });
    }

    const profilePhoto = `/uploads/profile-photos/${req.file.filename}`;
    
    // Remove old photo if exists
    const user = await User.findById(req.patient._id);
    if (user.profile_photo) {
      const oldPhotoPath = path.join(__dirname, '../../', user.profile_photo);
      if (fs.existsSync(oldPhotoPath)) {
        fs.unlinkSync(oldPhotoPath);
      }
    }
    
    await User.findByIdAndUpdate(req.patient._id, {
      $set: { profile_photo: profilePhoto }
    });

    res.json({ message: 'Photo uploaded successfully', profilePhoto });
  } catch (error) {
    console.error('Upload photo error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove profile photo
router.delete('/remove-photo', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.patient._id);
    
    if (user.profile_photo) {
      // Remove file from filesystem
      const photoPath = path.join(__dirname, '../../', user.profile_photo);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
      
      // Remove photo reference from database
      await User.findByIdAndUpdate(req.patient._id, {
        $unset: { profile_photo: 1 }
      });
    }

    res.json({ message: 'Photo removed successfully' });
  } catch (error) {
    console.error('Remove photo error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get family members
router.get('/family-members', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const familyMembers = await FamilyMember.find({ patient_id: req.patient._id });
    res.json({ familyMembers });
  } catch (error) {
    console.error('Get family members error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add family member
router.post('/family-members', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const {
      name,
      age,
      gender,
      phone,
      relation,
      bloodGroup,
      allergies,
      chronicConditions
    } = req.body;

    // Generate unique patient ID for family member
    const patientId = `FM${Date.now().toString().slice(-6)}`;

    const familyMember = new FamilyMember({
      patient_id: req.patient._id,
      name,
      age,
      gender,
      phone,
      relation,
      patientId,
      bloodGroup,
      allergies,
      chronicConditions
    });

    await familyMember.save();
    res.status(201).json({ message: 'Family member added successfully', familyMember });
  } catch (error) {
    console.error('Add family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update family member
router.put('/family-members/:id', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const familyMember = await FamilyMember.findOneAndUpdate(
      { _id: id, patient_id: req.patient._id },
      { $set: updateData },
      { new: true }
    );

    if (!familyMember) {
      return res.status(404).json({ message: 'Family member not found' });
    }

    res.json({ message: 'Family member updated successfully', familyMember });
  } catch (error) {
    console.error('Update family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete family member
router.delete('/family-members/:id', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const familyMember = await FamilyMember.findOneAndDelete({
      _id: id,
      patient_id: req.patient._id
    });

    if (!familyMember) {
      return res.status(404).json({ message: 'Family member not found' });
    }

    res.json({ message: 'Family member deleted successfully' });
  } catch (error) {
    console.error('Delete family member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Change password
router.put('/change-password', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    const user = await User.findById(req.patient._id);
    
    // Verify current password
    const bcrypt = require('bcryptjs');
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    await User.findByIdAndUpdate(req.patient._id, {
      $set: { password: hashedNewPassword }
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get account settings
router.get('/account-settings', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.patient._id).select('account_settings');
    res.json({ settings: user.account_settings || {} });
  } catch (error) {
    console.error('Get account settings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update account settings
router.put('/account-settings', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const settings = req.body;

    await User.findByIdAndUpdate(req.patient._id, {
      $set: { account_settings: settings }
    });

    res.json({ message: 'Account settings updated successfully' });
  } catch (error) {
    console.error('Update account settings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Deactivate account
router.put('/deactivate-account', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.patient._id, {
      $set: { 
        isActive: false,
        deactivatedAt: new Date()
      }
    });

    res.json({ message: 'Account deactivated successfully' });
  } catch (error) {
    console.error('Deactivate account error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
