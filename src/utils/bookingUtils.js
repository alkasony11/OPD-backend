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
 * Generate sequential token number based on existing appointments
 * Token numbers are continuous across all departments for each day (T001, T002, T003...)
 * @param {string} doctorId - Doctor ID
 * @param {Date} appointmentDate - Appointment date
 * @param {string} sessionType - 'morning', 'afternoon', or 'evening'
 * @returns {Promise<string>} - Sequential token number (T001-T999)
 */
async function generateSequentialTokenNumber(doctorId, appointmentDate, sessionType, patientId, familyMemberId = null) {
  const { Token, Counter } = require('../models/User');
  const mongoose = require('mongoose');
  
  // Normalize appointment date to start of day for consistent comparison
  const appointmentDay = new Date(appointmentDate);
  appointmentDay.setHours(0, 0, 0, 0);
  
  // Determine the user identifier (patient or family member)
  const userId = familyMemberId || patientId;
  const userType = familyMemberId ? 'family_member' : 'patient';
  
  console.log(`[TOKEN-GEN] Generating global token for ${userType} ${userId} with doctor ${doctorId} on ${appointmentDay.toDateString()} for ${sessionType} session`);
  
  // Create a unique counter key for the date (global across all departments)
  const counterKey = `token_${appointmentDay.toISOString().split('T')[0]}`;
  
  // Use atomic findAndModify to get the next sequential number
  const maxRetries = 10;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[TOKEN-GEN] Attempt ${attempt}: Getting next token number for counter: ${counterKey}`);
      
      // Atomically increment the counter and get the new value
      const counter = await Counter.findOneAndUpdate(
        { key: counterKey },
        { $inc: { count: 1 } },
        { 
          upsert: true, 
          new: true, 
          setDefaultsOnInsert: true 
        }
      );
      
      const nextNumber = counter.count;
      console.log(`[TOKEN-GEN] Counter returned number: ${nextNumber}`);
      
      // Ensure we don't exceed reasonable limits (T001-T999)
      if (nextNumber > 999) {
        throw new Error(`No more tokens available for ${appointmentDay.toDateString()}. Maximum 999 tokens per day.`);
      }
      
      const tokenNumber = `T${nextNumber.toString().padStart(3, '0')}`;
      console.log(`[TOKEN-GEN] Generated token: ${tokenNumber} for ${userType} ${userId} (attempt ${attempt})`);
      
      // Verify the token number is unique by attempting to find an existing one
      const existingToken = await Token.findOne({ token_number: tokenNumber });
      if (existingToken) {
        console.log(`[TOKEN-GEN] Token ${tokenNumber} already exists, retrying...`);
        if (attempt === maxRetries) {
          throw new Error(`Failed to generate unique token number after ${maxRetries} attempts. Please try again.`);
        }
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 50 * attempt));
        continue;
      }
      
      return tokenNumber;
      
    } catch (error) {
      console.error(`[TOKEN-GEN] Attempt ${attempt} failed:`, error.message);
      
      if (error.code === 11000 && error.keyPattern?.token_number) {
        // Duplicate key error - token number already exists
        console.log(`[TOKEN-GEN] Duplicate token number detected, retrying...`);
        if (attempt === maxRetries) {
          throw new Error(`Failed to generate unique token number after ${maxRetries} attempts. Please try again.`);
        }
        // Wait a bit before retrying to avoid race conditions
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        continue;
      } else if (attempt === maxRetries) {
        // Final attempt failed
        throw new Error(`Failed to generate token number: ${error.message}`);
      } else {
        // Wait before retrying for other errors
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        continue;
      }
    }
  }
}

module.exports = {
  isSessionBookable,
  getSessionInfo,
  parseTime,
  formatTime,
  getBookingCutoffMessage,
  generateSequentialTokenNumber
};
