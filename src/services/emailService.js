const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');
require('dotenv').config();

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// SMTP Configuration
const smtpConfig = {
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
};

// Create SMTP transporter
const smtpTransporter = nodemailer.createTransport(smtpConfig);

class EmailService {
  constructor() {
    this.smtpEnabled = false;
    this.sendgridEnabled = !!process.env.SENDGRID_API_KEY;
    this.initialized = false;
    this.init();
  }

  async init() {
    await this.testConfigurations();
    this.initialized = true;
  }

  async testConfigurations() {
    // Test SMTP configuration
    try {
      await smtpTransporter.verify();
      this.smtpEnabled = true;
      console.log('✅ SMTP configuration is valid');
    } catch (error) {
      console.log('❌ SMTP configuration error:', error.message);
      this.smtpEnabled = false;
    }

    // Test SendGrid configuration
    if (this.sendgridEnabled) {
      console.log('✅ SendGrid API key is configured');
    } else {
      console.log('❌ SendGrid API key not found');
    }
  }

  async sendEmail(emailData) {
    // Wait for initialization if not ready
    if (!this.initialized) {
      await this.init();
    }

    const { to, subject, text, html, from } = emailData;

    // Try SMTP first if available
    if (this.smtpEnabled) {
      try {
        console.log('📧 Attempting to send email via SMTP...');
        const result = await this.sendViaSMTP(emailData);
        console.log('✅ Email sent successfully via SMTP');
        return { success: true, method: 'SMTP', result };
      } catch (error) {
        console.log('❌ SMTP failed, trying SendGrid fallback...', error.message);
      }
    }

    // Fallback to SendGrid
    if (this.sendgridEnabled) {
      try {
        console.log('📧 Attempting to send email via SendGrid...');
        const result = await this.sendViaSendGrid(emailData);
        console.log('✅ Email sent successfully via SendGrid');
        return { success: true, method: 'SendGrid', result };
      } catch (error) {
        console.error('❌ SendGrid also failed:', error.message);
        return { success: false, error: error.message };
      }
    }

    // Both methods failed
    console.error('❌ All email methods failed');
    return { 
      success: false, 
      error: 'Both SMTP and SendGrid are unavailable' 
    };
  }

  async sendViaSMTP(emailData) {
    const { to, subject, text, html, from } = emailData;
    
    const mailOptions = {
      from: from || process.env.EMAIL_USER || 'noreply@yourdomain.com',
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html
    };

    return await smtpTransporter.sendMail(mailOptions);
  }

  async sendViaSendGrid(emailData) {
    const { to, subject, text, html, from } = emailData;
    
    const msg = {
      to: Array.isArray(to) ? to : [to],
      from: from || process.env.SENDGRID_FROM_EMAIL || 'noreply@yourdomain.com',
      subject,
      text,
      html
    };

    return await sgMail.send(msg);
  }

  // Convenience method for common email types
  async sendBookingConfirmation(patientEmail, appointmentDetails) {
    const emailData = {
      to: patientEmail,
      subject: 'Appointment Confirmation',
      html: `
        <h2>Appointment Confirmed</h2>
        <p>Dear Patient,</p>
        <p>Your appointment has been confirmed with the following details:</p>
        <ul>
          <li><strong>Date:</strong> ${appointmentDetails.date}</li>
          <li><strong>Time:</strong> ${appointmentDetails.time}</li>
          <li><strong>Doctor:</strong> ${appointmentDetails.doctorName}</li>
          <li><strong>Department:</strong> ${appointmentDetails.department}</li>
        </ul>
        <p>Please arrive 15 minutes before your scheduled time.</p>
        <p>Thank you for choosing our services.</p>
      `,
      text: `
        Appointment Confirmed
        
        Dear Patient,
        
        Your appointment has been confirmed with the following details:
        - Date: ${appointmentDetails.date}
        - Time: ${appointmentDetails.time}
        - Doctor: ${appointmentDetails.doctorName}
        - Department: ${appointmentDetails.department}
        
        Please arrive 15 minutes before your scheduled time.
        Thank you for choosing our services.
      `
    };

    return await this.sendEmail(emailData);
  }

  async sendPasswordReset(email, resetLink) {
    const emailData = {
      to: email,
      subject: 'Password Reset Request',
      html: `
        <h2>Password Reset Request</h2>
        <p>You have requested to reset your password.</p>
        <p>Click the link below to reset your password:</p>
        <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
      text: `
        Password Reset Request
        
        You have requested to reset your password.
        
        Click the link below to reset your password:
        ${resetLink}
        
        This link will expire in 1 hour.
        If you didn't request this, please ignore this email.
      `
    };

    return await this.sendEmail(emailData);
  }

  async sendNotification(email, notificationData) {
    const emailData = {
      to: email,
      subject: notificationData.subject || 'Notification',
      html: notificationData.html || notificationData.message,
      text: notificationData.text || notificationData.message
    };

    return await this.sendEmail(emailData);
  }

  // Get service status
  async getStatus() {
    // Wait for initialization if not ready
    if (!this.initialized) {
      await this.init();
    }
    
    return {
      smtp: this.smtpEnabled,
      sendgrid: this.sendgridEnabled,
      available: this.smtpEnabled || this.sendgridEnabled
    };
  }
}

// Create singleton instance
const emailService = new EmailService();

module.exports = emailService;
