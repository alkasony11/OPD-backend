const { transporter } = require('./src/config/email');
const notificationService = require('./src/services/notificationService');

async function testEmailService() {
  console.log('📧 Testing Email Service...\n');

  try {
    // Test 1: Check email configuration
    console.log('1. Testing email configuration...');
    const isEmailConfigured = process.env.EMAIL_USER && process.env.EMAIL_PASS;
    console.log('Email configured:', isEmailConfigured ? '✅ Yes' : '❌ No');
    
    if (isEmailConfigured) {
      console.log('Email User:', process.env.EMAIL_USER);
      console.log('Email Pass:', process.env.EMAIL_PASS ? '***hidden***' : 'Not set');
    }

    // Test 2: Verify SMTP connection
    console.log('\n2. Testing SMTP connection...');
    try {
      await transporter.verify();
      console.log('✅ SMTP connection successful');
    } catch (error) {
      console.log('❌ SMTP connection failed:', error.message);
      return;
    }

    // Test 3: Send test email
    console.log('\n3. Sending test email...');
    const testEmailData = {
      patientName: 'Test Patient',
      doctorName: 'Dr. Test Doctor',
      department: 'Test Department',
      appointmentDate: 'Monday, December 23, 2024',
      appointmentTime: '10:00 AM',
      tokenNumber: 'T1234',
      email: process.env.EMAIL_USER // Send to yourself for testing
    };

    try {
      const result = await notificationService.sendBookingConfirmationEmail(testEmailData);
      console.log('✅ Test email sent successfully!');
      console.log('Message ID:', result.messageId);
    } catch (error) {
      console.log('❌ Test email failed:', error.message);
      console.log('Error details:', error);
    }

    // Test 4: Test notification service status
    console.log('\n4. Testing notification service status...');
    const serviceStatus = await notificationService.testAllServices();
    console.log('Email service status:', serviceStatus.email);

  } catch (error) {
    console.error('❌ Email test failed:', error.message);
    console.error('Full error:', error);
  }
}

// Run the test
testEmailService().then(() => {
  console.log('\n✅ Email test completed!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test error:', error);
  process.exit(1);
});
