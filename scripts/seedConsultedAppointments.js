/*
Script: seedConsultedAppointments.js
Purpose: Create a set of "consulted" appointments (Token documents) for an existing doctor and patient,
so the ML training module has enough historical training data.

Usage:
  node backend/scripts/seedConsultedAppointments.js

Notes:
- This script uses the same .env MongoDB connection as the main app.
- It will not overwrite existing tokens; it will create new tokens after existing token numbers for the selected doctor/date.
*/

require('dotenv').config();
const mongoose = require('mongoose');
const { User, Token } = require('../src/models/User');

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('MONGODB_URI is not set in .env');
  process.exit(1);
}

async function main() {
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  // Find a doctor and a patient (choose first ones)
  const doctor = await User.findOne({ role: 'doctor' });
  const patient = await User.findOne({ role: 'patient' });

  if (!doctor) {
    console.error('No doctor found in database. Create at least one doctor first.');
    process.exit(1);
  }
  if (!patient) {
    console.error('No patient found in database. Register at least one patient first.');
    process.exit(1);
  }

  // Choose a training date (two days ago) to avoid clashing with live booking
  const trainingDate = new Date();
  trainingDate.setDate(trainingDate.getDate() - 2);
  trainingDate.setHours(0, 0, 0, 0);

  const nextDay = new Date(trainingDate);
  nextDay.setDate(nextDay.getDate() + 1);

  // Find highest token number for that doctor/day (to avoid duplicates)
  const existingTokens = await Token.find({
    doctor_id: doctor._id,
    booking_date: { $gte: trainingDate, $lt: nextDay }
  }).select('token_number');

  const existingNumbers = existingTokens
    .map(t => parseInt(t.token_number, 10))
    .filter(n => !isNaN(n));

  const maxExisting = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
  const startToken = maxExisting + 1;

  const numToCreate = 10;
  const consultationLength = doctor.doctor_info?.avgConsultationTime || 10;

  const created = [];

  for (let i = 0; i < numToCreate; i++) {
    const tokenNumber = (startToken + i).toString();

    // Schedule each appointment 10 minutes apart
    const appointmentStart = new Date(trainingDate);
    appointmentStart.setHours(9, 0, 0, 0);
    appointmentStart.setMinutes(appointmentStart.getMinutes() + (i * 10));

    const appointmentEnd = new Date(appointmentStart);
    appointmentEnd.setMinutes(appointmentEnd.getMinutes() + consultationLength);

    const bookingTime = new Date(appointmentStart);
    bookingTime.setMinutes(bookingTime.getMinutes() - (5 + i));

    const tokenDoc = new Token({
      patient_id: patient._id,
      patient_name: patient.name,
      patient_email: patient.email,
      doctor_id: doctor._id,
      department: doctor.doctor_info?.department?.toString() || 'General',
      symptoms: 'Routine checkup',
      booking_date: trainingDate,
      time_slot: appointmentStart.toTimeString().slice(0, 5),
      status: 'consulted',
      startTime: appointmentStart,
      endTime: appointmentEnd,
      actualDuration: consultationLength,
      token_number: tokenNumber,
      session_type: 'morning',
      session_time_range: '09:00-12:00',
      appointment_type: 'in-person',
      created_by: 'receptionist',
      estimated_wait_time: 0
    });

    await tokenDoc.save();
    created.push(tokenDoc);
  }

  console.log(`✅ Created ${created.length} consulted appointments for doctor ${doctor.name} (ID: ${doctor._id})`);
  console.log('Sample token numbers:', created.slice(0, 5).map(t => t.token_number));

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
  process.exit(0);
}

main().catch(err => {
  console.error('Error seeding consulted appointments:', err);
  process.exit(1);
});
