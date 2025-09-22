const notificationService = require('./src/services/notificationService');
const { User, Token } = require('./src/models/User');
const Department = require('./src/models/Department');
const mongoose = require('mongoose');

async function testRealBookingScenario() {
  console.log('🧪 Testing Real Booking Notification Scenario...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/opd';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Create a test appointment
    console.log('\n1. Creating test appointment...');
    
    // Find an existing patient
    let patient = await User.findOne({ role: 'patient' });
    if (!patient) {
      console.log('❌ No existing patients found. Please create a patient first.');
      return;
    } else {
      console.log('✅ Found existing patient:', patient.name);
    }

    // Find an existing doctor
    let doctor = await User.findOne({ role: 'doctor' });
    if (!doctor) {
      console.log('❌ No existing doctors found. Please create a doctor first.');
      return;
    } else {
      console.log('✅ Found existing doctor:', doctor.name);
    }

    // Find an existing department
    let department = await Department.findOne();
    if (!department) {
      console.log('❌ No existing departments found. Please create a department first.');
      return;
    } else {
      console.log('✅ Found existing department:', department.name);
    }

    // Create test appointment
    const appointment = new Token({
      patient_id: patient._id,
      doctor_id: doctor._id,
      department: department.name,
      symptoms: 'Test symptoms',
      booking_date: new Date(),
      time_slot: '10:00 AM',
      session_type: 'morning',
      session_time_range: '9:00 AM - 1:00 PM',
      status: 'booked',
      token_number: 'T' + Date.now().toString().slice(-4),
      payment_status: 'pending',
      created_by: 'patient',
      estimated_wait_time: 15
    });

    await appointment.save();
    console.log('✅ Created test appointment:', appointment._id);

    // Test the notification service
    console.log('\n2. Testing notification service...');
    try {
      const result = await notificationService.sendBookingConfirmation(appointment._id);
      console.log('✅ Notification service completed successfully');
      console.log('Results:', result);
    } catch (error) {
      console.log('❌ Notification service failed:', error.message);
      console.log('Error details:', error);
    }

    // Clean up test data
    console.log('\n3. Cleaning up test data...');
    await Token.findByIdAndDelete(appointment._id);
    console.log('✅ Cleaned up test appointment');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
  }
}

// Run the test
testRealBookingScenario().then(() => {
  console.log('\n🎉 Real booking test completed!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test error:', error);
  process.exit(1);
});
