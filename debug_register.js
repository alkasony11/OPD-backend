const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, OTP } = require('./src/models/User');

async function testRegistration() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Test data
    const testData = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
      phone: '1234567890',
      age: 25,
      dob: new Date('1998-01-01'),
      gender: 'male',
      role: 'patient',
      isVerified: true,
      patient_info: {
        family_members: [],
        booking_history: []
      }
    };

    console.log('Creating user...');
    
    // Hash password
    const hashedPassword = await bcrypt.hash(testData.password, 12);
    testData.password = hashedPassword;

    // Create user
    const user = new User(testData);
    
    console.log('Saving user...');
    await user.save();
    
    console.log('User created successfully:', {
      id: user._id,
      name: user.name,
      email: user.email,
      patientId: user.patientId,
      role: user.role
    });

  } catch (error) {
    console.error('Error during registration test:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      errors: error.errors
    });
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Load environment variables
require('dotenv').config();
testRegistration();

