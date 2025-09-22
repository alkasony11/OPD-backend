const notificationService = require('./src/services/notificationService');
const smsService = require('./src/services/smsService');

async function testNotificationServices() {
  console.log('🔔 Testing Notification Services...\n');

  try {
    // Test all services configuration
    const serviceStatus = await notificationService.testAllServices();
    
    console.log('\n📊 Service Status:');
    console.log('==================');
    console.log('Email Service:', serviceStatus.email.enabled ? '✅ Enabled' : '❌ Disabled');
    console.log('SMS Service:', serviceStatus.sms.enabled ? '✅ Enabled' : '❌ Disabled');
    console.log('WhatsApp Service:', serviceStatus.whatsapp.enabled ? '✅ Enabled' : '❌ Disabled');
    
    console.log('\n📋 Configuration Status:');
    console.log('========================');
    console.log('Email:', serviceStatus.email.status);
    console.log('SMS:', serviceStatus.sms.status);
    console.log('WhatsApp:', serviceStatus.whatsapp.status);

    // Test SMS service specifically
    console.log('\n📱 Testing SMS Service...');
    const smsTest = await smsService.testConfiguration();
    console.log('SMS Test Result:', smsTest ? '✅ Passed' : '❌ Failed');

    console.log('\n🔧 Environment Variables Required:');
    console.log('===================================');
    console.log('For Email Service:');
    console.log('  EMAIL_USER=your-gmail@gmail.com');
    console.log('  EMAIL_PASS=your-app-password');
    console.log('');
    console.log('For SMS Service:');
    console.log('  TWILIO_ACCOUNT_SID=your_account_sid');
    console.log('  TWILIO_AUTH_TOKEN=your_auth_token');
    console.log('  TWILIO_PHONE_NUMBER=your_twilio_phone');
    console.log('');
    console.log('For WhatsApp Service:');
    console.log('  WHATSAPP_ACCESS_TOKEN=your_access_token');
    console.log('  WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id');
    console.log('  WHATSAPP_WEBHOOK_URL=https://your-domain.com/api/whatsapp/webhook');
    console.log('  WHATSAPP_VERIFY_TOKEN=your_verify_token');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testNotificationServices().then(() => {
  console.log('\n✅ Notification services test completed!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test error:', error);
  process.exit(1);
});
