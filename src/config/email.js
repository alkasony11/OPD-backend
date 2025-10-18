const nodemailer = require('nodemailer');
require('dotenv').config();

// Simple Gmail SMTP configuration
const emailConfig = {
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
};

// Create transporter
const transporter = nodemailer.createTransport(emailConfig);

// Test email configuration
const testEmailConfig = async () => {
  try {
    await transporter.verify();
    console.log('✅ Email configuration is valid');
    return true;
  } catch (error) {
    console.error('❌ Email configuration error:', error.message);
    console.log('📧 To set up email, create a .env file with:');
    console.log('   EMAIL_USER=your-gmail@gmail.com');
    console.log('   EMAIL_PASS=your-app-password');
    return false;
  }
};

module.exports = {
  transporter,
  testEmailConfig,
  emailConfig
};