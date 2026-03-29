const mongoose = require('mongoose');
require('dotenv').config();

const { Token } = require('./src/models/User');

async function checkAppointments() {
  try {
    const uri = process.env.MONGODB_URI;
    await mongoose.connect(uri);

    const targetDateStr = '2026-03-25';
    const startOfDay = new Date(targetDateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const appointments = await Token.find({
      booking_date: {
        $gte: startOfDay,
        $lt: endOfDay
      }
    }).lean();

    console.log(`Found ${appointments.length} appointments for ${targetDateStr}:`);
    appointments.forEach(a => {
      console.log(`- Token: ${a.token_number || 'N/A'}, Session: ${a.session_type}, Status: ${a.status}, Time: ${a.booking_date}`);
      console.log(`  Patient: ${a.patient_id}, Doctor: ${a.doctor_id}`);
    });
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAppointments();
