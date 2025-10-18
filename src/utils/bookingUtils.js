/**
 * Booking utility functions for session management and time-based cutoffs
 */

/**
 * Check if a session is still bookable based on current time
 * @param {string|Date} date - The appointment date (YYYY-MM-DD format or Date object)
 * @param {string} sessionType - 'morning' or 'afternoon'
 * @returns {boolean} - True if session is still bookable, false otherwise
 */
function isSessionBookable(date, sessionType) {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  
  // Parse the date if it's a string
  let scheduleDate;
  if (typeof date === 'string') {
    const parts = date.split('-').map(Number);
    if (parts.length === 3 && parts.every(n => !Number.isNaN(n))) {
      scheduleDate = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
      scheduleDate = new Date(date);
    }
  } else {
    scheduleDate = new Date(date);
  }
  scheduleDate.setHours(0, 0, 0, 0);
  
  // If it's not today, session is bookable
  if (scheduleDate.getTime() !== today.getTime()) {
    return true;
  }
  
  // For today, check if session has passed the booking cutoff
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM format
  
  if (sessionType === 'morning') {
    // Morning session booking cutoff: 8:00 AM (1 hour before 9:00 AM start)
    return currentTime < '08:00';
  } else if (sessionType === 'afternoon') {
    // Afternoon session booking cutoff: 1:00 PM (1 hour before 2:00 PM start)
    return currentTime < '13:00';
  }
  
  return true;
}

/**
 * Get session information for a given time
 * @param {string} timeSlot - Time slot in HH:MM format
 * @returns {object} - Session information
 */
function getSessionInfo(timeSlot) {
  const time = parseTime(timeSlot);
  
  if (time >= parseTime('09:00') && time < parseTime('13:00')) {
    return {
      type: 'morning',
      name: 'Morning Session',
      startTime: '09:00',
      endTime: '13:00',
      bookingCutoff: '08:00'
    };
  } else if (time >= parseTime('14:00') && time < parseTime('18:00')) {
    return {
      type: 'afternoon',
      name: 'Afternoon Session',
      startTime: '14:00',
      endTime: '18:00',
      bookingCutoff: '13:00'
    };
  }
  
  return {
    type: 'other',
    name: 'Working Hours',
    startTime: null,
    endTime: null,
    bookingCutoff: null
  };
}

/**
 * Parse time string to minutes since midnight
 * @param {string} timeStr - Time in HH:MM format
 * @returns {number} - Minutes since midnight
 */
function parseTime(timeStr) {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

/**
 * Format minutes since midnight to HH:MM
 * @param {number} minutes - Minutes since midnight
 * @returns {string} - Time in HH:MM format
 */
function formatTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Get booking cutoff error message
 * @param {string} sessionName - Name of the session
 * @param {string} currentTime - Current time in HH:MM format
 * @returns {string} - Error message
 */
function getBookingCutoffMessage(sessionName, currentTime) {
  if (sessionName === 'Morning Session') {
    return `Morning session booking has closed. Booking for morning sessions closes at 8:00 AM. Current time: ${currentTime}`;
  } else if (sessionName === 'Afternoon Session') {
    return `Afternoon session booking has closed. Booking for afternoon sessions closes at 1:00 PM. Current time: ${currentTime}`;
  }
  return `Session booking has closed. Current time: ${currentTime}`;
}

/**
 * Generate sequential token number based on session type and existing appointments
 * Token numbers reset to 1-20 for each new day
 * @param {string} doctorId - Doctor ID
 * @param {Date} appointmentDate - Appointment date
 * @param {string} sessionType - 'morning', 'afternoon', or 'evening'
 * @returns {Promise<string>} - Sequential token number (T001-T020)
 */
async function generateSequentialTokenNumber(doctorId, appointmentDate, sessionType) {
  const mongoose = require('mongoose');
  const Token = mongoose.model('Token');
  
  // Normalize appointment date to start of day for consistent comparison
  const appointmentDay = new Date(appointmentDate);
  appointmentDay.setHours(0, 0, 0, 0);
  
  // Calculate exact date range for this specific day only
  const startOfDay = new Date(appointmentDay);
  const endOfDay = new Date(appointmentDay);
  endOfDay.setHours(23, 59, 59, 999);
  
  console.log(`[TOKEN-GEN] Generating token for doctor ${doctorId} on ${appointmentDay.toDateString()} for ${sessionType} session`);
  
  // Get all existing appointments for this doctor on this specific date only
  const existingAppointments = await Token.find({
    doctor_id: doctorId,
    booking_date: { $gte: startOfDay, $lte: endOfDay },
    status: { $nin: ['cancelled', 'missed'] }
  }).sort({ created_at: 1 }); // Sort by creation time to maintain order
  
  console.log(`[TOKEN-GEN] Found ${existingAppointments.length} existing appointments for this date`);
  
  // Determine the base number and range for the session
  let baseNumber, maxNumber;
  if (sessionType === 'morning') {
    baseNumber = 1;  // Morning: T001-T010
    maxNumber = 10;
  } else if (sessionType === 'afternoon') {
    baseNumber = 11; // Afternoon: T011-T020
    maxNumber = 20;
  } else if (sessionType === 'evening') {
    baseNumber = 21; // Evening: T021-T030
    maxNumber = 30;
  } else {
    // For 'other' session type, use working hours range
    baseNumber = 1;
    maxNumber = 20;
  }
  
  // Find used token numbers for this session on this specific date
  const usedNumbers = existingAppointments
    .filter(apt => {
      const aptSessionType = getSessionInfo(apt.time_slot).type;
      return aptSessionType === sessionType;
    })
    .map(apt => {
      // Extract number from token_number (e.g., "T001" -> 1)
      const match = apt.token_number?.match(/T(\d+)/);
      return match ? parseInt(match[1]) : null;
    })
    .filter(num => num !== null && num >= baseNumber && num <= maxNumber);
  
  console.log(`[TOKEN-GEN] Used numbers for ${sessionType} session: [${usedNumbers.join(', ')}]`);
  
  // Find the next available number in the session range
  let nextNumber = baseNumber;
  
  while (nextNumber <= maxNumber && usedNumbers.includes(nextNumber)) {
    nextNumber++;
  }
  
  if (nextNumber > maxNumber) {
    throw new Error(`No more tokens available for ${sessionType} session on ${appointmentDay.toDateString()}. Maximum ${maxNumber} tokens per session.`);
  }
  
  const tokenNumber = `T${nextNumber.toString().padStart(3, '0')}`;
  console.log(`[TOKEN-GEN] Generated token: ${tokenNumber} for ${sessionType} session`);
  
  return tokenNumber;
}

module.exports = {
  isSessionBookable,
  getSessionInfo,
  parseTime,
  formatTime,
  getBookingCutoffMessage,
  generateSequentialTokenNumber
};
