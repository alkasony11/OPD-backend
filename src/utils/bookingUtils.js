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
    // Morning session: allow booking until the session starts at 9:00 AM
    return currentTime < '09:00';
  } else if (sessionType === 'afternoon') {
    // Afternoon session: allow booking until the session starts at 2:00 PM
    return currentTime < '14:00';
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
 * Generate sequential token number based on existing appointments
 * Token numbers are continuous across all departments for each day (T001, T002, T003...)
 * @param {string} doctorId - Doctor ID
 * @param {Date} appointmentDate - Appointment date
 * @param {string} sessionType - 'morning', 'afternoon', or 'evening'
 * @returns {Promise<string>} - Sequential token number (T001-T999)
 */
async function generateSequentialTokenNumber(doctorId, appointmentDate, sessionType, patientId, familyMemberId = null) {
  const { Token } = require('../models/User');

  // Normalize appointment date to start of day for consistent comparison
  const baseDate = new Date(appointmentDate);
  baseDate.setHours(0, 0, 0, 0);

  // Create SEPARATE date objects for start and end of day — never mutate the same object
  const startOfDay = new Date(baseDate.getTime());
  const endOfDay = new Date(baseDate.getTime());
  endOfDay.setHours(23, 59, 59, 999);

  const userId = familyMemberId || patientId;
  const userType = familyMemberId ? 'family_member' : 'patient';

  console.log(`[TOKEN-GEN] Generating token for ${userType} ${userId} with doctor ${doctorId} on ${baseDate.toDateString()}`);
  console.log(`[TOKEN-GEN] Date range: ${startOfDay.toISOString()} → ${endOfDay.toISOString()}`);

  const maxRetries = 10;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Include ALL statuses (including cancelled/missed) so we never reuse a token number
      // that was previously assigned. This prevents the gap-fill from picking up cancelled
      // tokens as "free", which would then fail the duplicate check.
      const existingTokens = await Token.find({
        doctor_id: doctorId,
        booking_date: { $gte: startOfDay, $lt: endOfDay },
        session_type: sessionType
        // No status filter — count every token ever generated for this slot
      }).select('token_number').lean();

      console.log(`[TOKEN-GEN] Attempt ${attempt}: Found ${existingTokens.length} existing tokens (all statuses) for session ${sessionType}`);

      // Extract and sort numeric values (e.g., T001 -> 1)
      const usedNumbers = existingTokens
        .map(t => parseInt((t.token_number || '').replace('T', ''), 10))
        .filter(n => !isNaN(n) && n > 0)
        .sort((a, b) => a - b);

      // Find the next available number (no gaps, just sequential after last used)
      let nextNumber = 1;
      for (const num of usedNumbers) {
        if (num === nextNumber) {
          nextNumber++;
        }
        // Skip gaps — we do NOT reuse cancelled token numbers
      }

      const tokenNumber = `T${nextNumber.toString().padStart(3, '0')}`;
      console.log(`[TOKEN-GEN] Next token: ${tokenNumber} (used: [${usedNumbers.join(',')}])`);

      // Final race-condition guard — check all statuses to prevent any collisions
      const duplicateCheck = await Token.findOne({
        token_number: tokenNumber,
        doctor_id: doctorId,
        session_type: sessionType,
        booking_date: { $gte: startOfDay, $lt: endOfDay }
        // No status filter here — must be unique across ALL statuses
      });

      if (duplicateCheck) {
        console.log(`[TOKEN-GEN] Race condition: ${tokenNumber} exists (status: ${duplicateCheck.status}). Retrying...`);
        await new Promise(resolve => setTimeout(resolve, Math.random() * 200));
        continue;
      }

      console.log(`[TOKEN-GEN] ✅ Token ${tokenNumber} confirmed unique. Returning.`);
      return tokenNumber;

    } catch (error) {
      console.error(`[TOKEN-GEN] Error on attempt ${attempt}:`, error);
      throw error;
    }
  }
  throw new Error('Failed to generate token after multiple attempts');
}


module.exports = {
  isSessionBookable,
  getSessionInfo,
  parseTime,
  formatTime,
  getBookingCutoffMessage,
  generateSequentialTokenNumber
};
