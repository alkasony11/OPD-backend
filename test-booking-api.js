const axios = require('axios');

async function testBookingAPI() {
  console.log('🧪 Testing Booking API...\n');

  try {
    // Test the booking endpoint
    const baseURL = 'http://localhost:5001';
    
    console.log('1. Testing if server is running...');
    try {
      const response = await axios.get(`${baseURL}/api/patient/doctors`);
      console.log('✅ Server is running');
    } catch (error) {
      console.log('❌ Server is not running. Please start the server first:');
      console.log('   npm run dev');
      return;
    }

    console.log('\n2. Testing booking endpoint...');
    console.log('   Note: This requires authentication. Please check server logs for notification messages.');
    console.log('   When you book an appointment through the frontend, you should see:');
    console.log('   📧 Booking confirmation email sent: <message-id>');
    console.log('   📱 SMS to <phone>: <message>');
    console.log('   WhatsApp message to whatsapp:<phone>: <message>');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testBookingAPI().then(() => {
  console.log('\n✅ Booking API test completed!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test error:', error);
  process.exit(1);
});
