const twilio = require('twilio');
require('dotenv').config();

class SMSService {
  constructor() {
    this.client = null;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
    
    // Initialize Twilio client if credentials are available and valid
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && 
        process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
      try {
        this.client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      } catch (error) {
        console.log('📱 SMS Service: Invalid Twilio credentials, running in development mode');
        this.client = null;
      }
    }
  }

  // Send SMS message
  async sendSMS(to, message) {
    try {
      // If Twilio is not configured, log the message for development
      if (!this.client) {
        console.log(`📱 SMS to ${to}: ${message}`);
        return {
          success: true,
          messageId: 'dev-' + Date.now(),
          message: 'SMS sent (development mode)'
        };
      }

      // Clean phone number (remove any non-digit characters except +)
      const cleanPhone = to.replace(/[^\d+]/g, '');
      
      // Ensure phone number starts with country code
      const phoneNumber = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;

      const result = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: phoneNumber
      });

      console.log(`📱 SMS sent successfully to ${phoneNumber}: ${result.sid}`);
      
      return {
        success: true,
        messageId: result.sid,
        message: 'SMS sent successfully'
      };
    } catch (error) {
      console.error('SMS sending error:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to send SMS'
      };
    }
  }

  // Send booking confirmation SMS
  async sendBookingConfirmation(appointmentData) {
    const {
      patientName,
      doctorName,
      department,
      appointmentDate,
      appointmentTime,
      tokenNumber,
      phoneNumber
    } = appointmentData;

    const message = `🏥 MediQ Hospital\n\n` +
      `Dear ${patientName},\n\n` +
      `Your appointment has been confirmed:\n\n` +
      `📅 Date: ${appointmentDate}\n` +
      `🕐 Time: ${appointmentTime}\n` +
      `👨‍⚕️ Doctor: Dr. ${doctorName}\n` +
      `🏥 Department: ${department}\n` +
      `🎫 Token: #${tokenNumber}\n\n` +
      `Please arrive 15 minutes early.\n` +
      `For queries, call: +91-9876543210\n\n` +
      `Thank you for choosing MediQ Hospital!`;

    return await this.sendSMS(phoneNumber, message);
  }

  // Send generic admin message
  async sendGeneric(phoneNumber, message) {
    return await this.sendSMS(phoneNumber, message);
  }

  // Send appointment reminder SMS
  async sendAppointmentReminder(appointmentData) {
    const {
      patientName,
      doctorName,
      appointmentDate,
      appointmentTime,
      tokenNumber,
      phoneNumber
    } = appointmentData;

    const message = `🏥 MediQ Hospital Reminder\n\n` +
      `Dear ${patientName},\n\n` +
      `This is a reminder for your appointment:\n\n` +
      `📅 Date: ${appointmentDate}\n` +
      `🕐 Time: ${appointmentTime}\n` +
      `👨‍⚕️ Doctor: Dr. ${doctorName}\n` +
      `🎫 Token: #${tokenNumber}\n\n` +
      `Please arrive 15 minutes early.\n` +
      `For queries, call: +91-9876543210`;

    return await this.sendSMS(phoneNumber, message);
  }

  // Send cancellation confirmation SMS
  async sendCancellationConfirmation(appointmentData) {
    const {
      patientName,
      doctorName,
      appointmentDate,
      appointmentTime,
      phoneNumber,
      refundInfo
    } = appointmentData;

    let message = `🏥 MediQ Hospital\n\n` +
      `Dear ${patientName},\n\n` +
      `Your appointment has been cancelled:\n\n` +
      `📅 Date: ${appointmentDate}\n` +
      `🕐 Time: ${appointmentTime}\n` +
      `👨‍⚕️ Doctor: Dr. ${doctorName}\n\n`;

    if (refundInfo && refundInfo.eligible) {
      message += `💰 Refund: ₹${refundInfo.amount} will be processed to your ${refundInfo.method} account.\n\n`;
    }

    message += `To book a new appointment, visit our website or call +91-9876543210.\n\n` +
      `Thank you for choosing MediQ Hospital!`;

    return await this.sendSMS(phoneNumber, message);
  }

  // Test SMS configuration
  async testConfiguration() {
    try {
      if (!this.client) {
        console.log('📱 SMS Service: Development mode (Twilio not configured)');
        console.log('To enable SMS, add to .env:');
        console.log('TWILIO_ACCOUNT_SID=your_account_sid');
        console.log('TWILIO_AUTH_TOKEN=your_auth_token');
        console.log('TWILIO_PHONE_NUMBER=your_twilio_phone');
        return false;
      }

      // Test with a simple message
      const testResult = await this.sendSMS('+1234567890', 'Test message from MediQ Hospital');
      console.log('📱 SMS Service: Configuration test successful');
      return testResult.success;
    } catch (error) {
      console.error('📱 SMS Service: Configuration test failed:', error.message);
      return false;
    }
  }
}

module.exports = new SMSService();
