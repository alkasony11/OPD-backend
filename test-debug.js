const mongoose = require('mongoose');
const { User, Token } = require('./src/models/User');

async function testDatabase() {
  try {
    // Try to connect to MongoDB
    console.log('🔍 Attempting to connect to MongoDB...');
    await mongoose.connect('mongodb://localhost:27017/opd');
    console.log('✅ Connected to MongoDB');

    // Check if there are any users
    const userCount = await User.countDocuments();
    console.log(`📊 Total users in database: ${userCount}`);

    // Check if there are any doctors
    const doctorCount = await User.countDocuments({ role: 'doctor' });
    console.log(`👨‍⚕️ Total doctors in database: ${doctorCount}`);

    // Check if there are any tokens
    const tokenCount = await Token.countDocuments();
    console.log(`🎫 Total tokens in database: ${tokenCount}`);

    // Get a sample doctor
    const sampleDoctor = await User.findOne({ role: 'doctor' });
    if (sampleDoctor) {
      console.log(`👨‍⚕️ Sample doctor: ${sampleDoctor.name} (${sampleDoctor.email})`);
      
      // Get tokens for this doctor
      const doctorTokens = await Token.find({ doctor_id: sampleDoctor._id });
      console.log(`🎫 Tokens for this doctor: ${doctorTokens.length}`);
      
      if (doctorTokens.length > 0) {
        console.log('📋 Sample tokens:');
        doctorTokens.slice(0, 3).forEach(token => {
          console.log(`  - ${token.patient_name} (${token.status}) on ${token.booking_date}`);
        });
      }
    } else {
      console.log('❌ No doctors found in database');
    }

    // Get a sample token
    const sampleToken = await Token.findOne().populate('patient_id', 'name email').populate('doctor_id', 'name email');
    if (sampleToken) {
      console.log(`🎫 Sample token: ${sampleToken.patient_id?.name || 'Unknown'} -> ${sampleToken.doctor_id?.name || 'Unknown'} (${sampleToken.status})`);
    } else {
      console.log('❌ No tokens found in database');
    }

  } catch (error) {
    console.error('❌ Database connection error:', error.message);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('💡 MongoDB is not running. Please start MongoDB first.');
      console.log('   On Windows, you can try:');
      console.log('   1. Install MongoDB from https://www.mongodb.com/try/download/community');
      console.log('   2. Start MongoDB service: net start MongoDB');
      console.log('   3. Or run: mongod --dbpath C:\\data\\db');
    }
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

testDatabase();
