/**
 * Comprehensive ML Training Data Seed Script
 * Creates 50+ high-quality training appointments with proper timestamps
 * 
 * Usage: node seedMLTrainingData.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { User, Token } = require('../src/models/User');

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('MONGODB_URI not set in .env');
  process.exit(1);
}

async function createTrainingData() {
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Get a doctor
    const doctor = await User.findOne({ role: 'doctor' });
    if (!doctor) {
      console.error('❌ No doctor found');
      process.exit(1);
    }

    // Get a patient
    const patient = await User.findOne({ role: 'patient' });
    if (!patient) {
      console.error('❌ No patient found');
      process.exit(1);
    }

    console.log(`📋 Using Doctor: ${doctor.name} (${doctor._id})`);
    console.log(`👤 Using Patient: ${patient.name} (${patient._id})`);

    // Create training data spanning last 60 days with varied times and circumstances
    const trainingRecords = [];
    const consultationTime = doctor.doctor_info?.avgConsultationTime || 12; // minutes

    // Generate 50 appointments across different days and times
    for (let dayOffset = 1; dayOffset <= 30; dayOffset++) {
      // Morning session (2-3 appointments per day)
      for (let morningSlot = 0; morningSlot < (dayOffset % 3); morningSlot++) {
        const appointmentDate = new Date();
        appointmentDate.setDate(appointmentDate.getDate() - dayOffset);
        appointmentDate.setHours(0, 0, 0, 0);

        // Start time: 9 AM + random minutes within first 3 hours
        const startTime = new Date(appointmentDate);
        startTime.setHours(9 + morningSlot);
        startTime.setMinutes(Math.random() * 60);

        // End time: start + consultation duration
        const endTime = new Date(startTime);
        endTime.setMinutes(endTime.getMinutes() + consultationTime + Math.random() * 5);

        // Booking time: random time before appointment (5-30 minutes)
        const bookingTime = new Date(startTime);
        bookingTime.setMinutes(bookingTime.getMinutes() - (5 + Math.random() * 25));

        const tokenNum = 100 + trainingRecords.length;

        trainingRecords.push({
          patient_id: patient._id,
          patient_name: patient.name,
          patient_email: patient.email,
          doctor_id: doctor._id,
          department: doctor.doctor_info?.department?.toString() || 'General',
          symptoms: ['Fever', 'Cough', 'Headache', 'Body pain', 'Fatigue', 'Chest pain'][Math.floor(Math.random() * 6)],
          booking_date: bookingTime,
          time_slot: `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`,
          status: 'consulted',
          startTime,
          endTime,
          actualDuration: consultationTime + Math.random() * 10,
          payment_status: 'paid',
          token_number: `T${tokenNum}`,
          cancellation_reason: '',
          session_type: startTime.getHours() < 12 ? 'morning' : (startTime.getHours() < 17 ? 'afternoon' : 'evening'),
          session_time_range: startTime.getHours() < 12 ? '09:00-12:00' : (startTime.getHours() < 17 ? '14:00-17:00' : '17:00-20:00'),
          appointment_type: 'in-person',
          created_by: 'receptionist',
          estimated_wait_time: 0,
          priority_flag: false,
          wait_notification_sent: false,
          doctor_info: doctor.doctor_info
        });
      }

      // Afternoon session (2 appointments per day)
      for (let afternoonSlot = 0; afternoonSlot < 2; afternoonSlot++) {
        const appointmentDate = new Date();
        appointmentDate.setDate(appointmentDate.getDate() - dayOffset);
        appointmentDate.setHours(0, 0, 0, 0);

        const startTime = new Date(appointmentDate);
        startTime.setHours(14 + afternoonSlot);
        startTime.setMinutes(Math.random() * 60);

        const endTime = new Date(startTime);
        endTime.setMinutes(endTime.getMinutes() + consultationTime + Math.random() * 5);

        const bookingTime = new Date(startTime);
        bookingTime.setMinutes(bookingTime.getMinutes() - (5 + Math.random() * 25));

        const tokenNum = 100 + trainingRecords.length;

        trainingRecords.push({
          patient_id: patient._id,
          patient_name: patient.name,
          patient_email: patient.email,
          doctor_id: doctor._id,
          department: doctor.doctor_info?.department?.toString() || 'General',
          symptoms: ['Fever', 'Cough', 'Headache', 'Body pain', 'Fatigue', 'Chest pain'][Math.floor(Math.random() * 6)],
          booking_date: bookingTime,
          time_slot: `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`,
          status: 'consulted',
          startTime,
          endTime,
          actualDuration: consultationTime + Math.random() * 10,
          payment_status: 'paid',
          token_number: `T${tokenNum}`,
          cancellation_reason: '',
          session_type: 'afternoon',
          session_time_range: '14:00-17:00',
          appointment_type: 'in-person',
          created_by: 'receptionist',
          estimated_wait_time: 0,
          priority_flag: false,
          wait_notification_sent: false
        });
      }
    }

    console.log(`\n📊 Creating ${trainingRecords.length} training appointments...`);

    // Insert all records
    const inserted = await Token.insertMany(trainingRecords, { ordered: false });
    console.log(`✅ Successfully created ${inserted.length} training appointments`);

    // Verify they were created
    const consulted = await Token.countDocuments({ status: 'consulted' });
    const withTimestamps = await Token.countDocuments({ 
      status: 'consulted', 
      startTime: { $exists: true },
      endTime: { $exists: true }
    });

    console.log(`\n✨ Statistics:`);
    console.log(`   Total consulted appointments: ${consulted}`);
    console.log(`   With proper timestamps: ${withTimestamps}`);
    console.log(`   Doctor: ${doctor.name}`);
    console.log(`   Appointment range: Last 30 days`);

    console.log(`\n🎯 ML Training should now work! Try:`);
    console.log(`   Admin Panel → ML Management → Train New Model`);

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error creating training data:', error.message);
    process.exit(1);
  }
}

createTrainingData();
