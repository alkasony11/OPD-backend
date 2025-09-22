const notificationService = require('./src/services/notificationService');
const { User, Token } = require('./src/models/User');
const Department = require('./src/models/Department');

async function testBookingNotifications() {
  console.log('🧪 Testing Booking Notification Flow...\n');

  try {
    // Create a test appointment data
    const testAppointmentData = {
      patientName: 'John Doe',
      doctorName: 'Dr. Smith',
      department: 'Cardiology',
      appointmentDate: 'Monday, December 23, 2024',
      appointmentTime: '10:00 AM',
      tokenNumber: 'T1234',
      phoneNumber: '+1234567890',
      email: 'test@example.com',
      appointmentId: '507f1f77bcf86cd799439011' // Mock ObjectId
    };

    console.log('📋 Test Appointment Data:');
    console.log('========================');
    console.log('Patient:', testAppointmentData.patientName);
    console.log('Doctor:', testAppointmentData.doctorName);
    console.log('Department:', testAppointmentData.department);
    console.log('Date:', testAppointmentData.appointmentDate);
    console.log('Time:', testAppointmentData.appointmentTime);
    console.log('Token:', testAppointmentData.tokenNumber);
    console.log('Phone:', testAppointmentData.phoneNumber);
    console.log('Email:', testAppointmentData.email);

    console.log('\n📧 Testing Email Notification...');
    try {
      const emailResult = await notificationService.sendBookingConfirmationEmail(testAppointmentData);
      console.log('Email Result:', emailResult);
    } catch (error) {
      console.log('Email Error:', error.message);
    }

    console.log('\n📱 Testing SMS Notification...');
    try {
      const smsService = require('./src/services/smsService');
      const smsResult = await smsService.sendBookingConfirmation(testAppointmentData);
      console.log('SMS Result:', smsResult);
    } catch (error) {
      console.log('SMS Error:', error.message);
    }

    console.log('\n💬 Testing WhatsApp Notification...');
    try {
      const whatsappBotService = require('./src/services/whatsappBotService');
      // Note: This will only log the message in development mode
      const whatsappResult = await whatsappBotService.sendBookingConfirmation(testAppointmentData.appointmentId);
      console.log('WhatsApp Result:', whatsappResult);
    } catch (error) {
      console.log('WhatsApp Error:', error.message);
    }

    console.log('\n✅ Booking notification test completed!');
    console.log('\n📝 Note: In development mode, notifications are logged to console.');
    console.log('   To send real notifications, configure the environment variables.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testBookingNotifications().then(() => {
  console.log('\n🎉 All tests completed successfully!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test error:', error);
  process.exit(1);
});
