const axios = require('axios');

// Test script for chatbot functionality
async function testChatbot() {
  const baseURL = 'http://localhost:5001';
  
  try {
    console.log('🤖 Testing MediQ Assistant Chatbot...\n');

    // Test 1: Test WhatsApp bot status (public endpoint)
    console.log('1. Testing WhatsApp bot status...');
    const whatsappResponse = await axios.get(`${baseURL}/api/whatsapp/status`);
    console.log('✅ WhatsApp Bot Status:', whatsappResponse.data.status);
    console.log('📱 Capabilities:', whatsappResponse.data.capabilities.join(', '));

    // Test 2: Test server connectivity
    console.log('\n2. Testing server connectivity...');
    const serverResponse = await axios.get(`${baseURL}/test`);
    console.log('✅ Server Response:', serverResponse.data.message);

    console.log('\n🎉 Basic tests passed! Chatbot system is ready.');
    console.log('\n📝 Next steps:');
    console.log('   1. Start the frontend: cd frontend && npm run dev');
    console.log('   2. Visit http://localhost:5173/chatbot');
    console.log('   3. Test the floating widget on patient pages');
    console.log('   4. Login as a patient to test full chatbot functionality');
    console.log('   5. Configure WhatsApp webhook for production');
    console.log('\n⚠️  Note: Chatbot endpoints require patient authentication.');
    console.log('   Login as a patient to test full functionality.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response:', error.response.data);
    }
  }
}

// Run the test
testChatbot();
