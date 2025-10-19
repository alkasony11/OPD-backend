const emailService = require('../services/emailService');
require('dotenv').config();

// Legacy support - maintain backward compatibility
const emailConfig = {
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
};

// Test email configuration
const testEmailConfig = async () => {
  const status = await emailService.getStatus();
  
  if (status.available) {
    console.log('✅ Email service is available');
    console.log(`   SMTP: ${status.smtp ? '✅' : '❌'}`);
    console.log(`   SendGrid: ${status.sendgrid ? '✅' : '❌'}`);
    return true;
  } else {
    console.error('❌ No email service available');
    console.log('📧 To set up email, create a .env file with:');
    console.log('   For SMTP:');
    console.log('     EMAIL_USER=your-gmail@gmail.com');
    console.log('     EMAIL_PASS=your-app-password');
    console.log('   For SendGrid:');
    console.log('     SENDGRID_API_KEY=your-sendgrid-api-key');
    console.log('     SENDGRID_FROM_EMAIL=your-verified-email@domain.com');
    return false;
  }
};

// Legacy transporter for backward compatibility
const transporter = {
  sendMail: async (mailOptions) => {
    const result = await emailService.sendEmail(mailOptions);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.result;
  }
};

module.exports = {
  transporter,
  testEmailConfig,
  emailConfig,
  emailService
};