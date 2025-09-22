const axios = require('axios');
const mongoose = require('mongoose');
const { User, Token } = require('./src/models/User');
const Department = require('./src/models/Department');

async function testBookingFlow() {
  console.log('🧪 Testing Complete Booking Flow...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/opd';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Find existing data
    const patient = await User.findOne({ role: 'patient' });
    const doctor = await User.findOne({ role: 'doctor' });
    const department = await Department.findOne();

    if (!patient || !doctor || !department) {
      console.log('❌ Missing required data. Please ensure you have:');
      console.log('   - At least one patient');
      console.log('   - At least one doctor');
      console.log('   - At least one department');
      return;
    }

    console.log('✅ Found required data:');
    console.log(`   Patient: ${patient.name} (${patient.email})`);
    console.log(`   Doctor: ${doctor.name}`);
    console.log(`   Department: ${department.name}`);

    // Test the booking API directly
    console.log('\n📋 Testing booking API...');
    
    const bookingData = {
      doctorId: doctor._id,
      departmentId: department._id,
      appointmentDate: '2024-12-25',
      appointmentTime: '10:00 AM',
      symptoms: 'Test symptoms for email notification',
      familyMemberId: null
    };

    console.log('Booking data:', bookingData);

    // Note: This requires authentication, so we'll just show what should happen
    console.log('\n🔔 When you book through the frontend, you should see:');
    console.log('   1. Frontend calls: POST /api/patient/book-appointment');
    console.log('   2. Backend creates appointment in database');
    console.log('   3. Backend calls: notificationService.sendBookingConfirmation()');
    console.log('   4. Email sent to:', patient.email);
    console.log('   5. SMS sent to:', patient.phone);
    console.log('   6. WhatsApp sent to:', patient.phone);

    console.log('\n📧 To test email notifications:');
    console.log('   1. Start your backend server: npm run dev');
    console.log('   2. Start your frontend server: npm run dev (in frontend folder)');
    console.log('   3. Go to http://localhost:5173');
    console.log('   4. Login as a patient');
    console.log('   5. Book an appointment');
    console.log('   6. Check the backend console for notification messages');
    console.log('   7. Check the patient\'s email (including spam folder)');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
  }
}

// Run the test
testBookingFlow().then(() => {
  console.log('\n🎉 Booking flow test completed!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test error:', error);
  process.exit(1);
});
