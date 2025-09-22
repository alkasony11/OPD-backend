const { transporter } = require('../config/email');
const smsService = require('./smsService');
const whatsappBotService = require('./whatsappBotService');
const { User, Token } = require('../models/User');

class NotificationService {
  constructor() {
    this.emailEnabled = process.env.EMAIL_USER && process.env.EMAIL_PASS;
    this.smsEnabled = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN;
    this.whatsappEnabled = process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID;
  }

  // Send booking confirmation via all enabled channels
  async sendBookingConfirmation(appointmentId) {
    try {
      const appointment = await Token.findById(appointmentId)
        .populate('patient_id', 'name email phone')
        .populate('doctor_id', 'name')
        .populate('family_member_id', 'name');

      if (!appointment) {
        throw new Error('Appointment not found');
      }

      const patientName = appointment.family_member_id ? 
        appointment.family_member_id.name : 
        appointment.patient_id.name;
      
      const doctorName = appointment.doctor_id.name;
      const appointmentDate = new Date(appointment.booking_date).toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const appointmentTime = appointment.time_slot;
      const tokenNumber = appointment.token_number;
      const department = appointment.department;
      const patientEmail = appointment.patient_id.email;
      const patientPhone = appointment.patient_id.phone;

      const appointmentData = {
        patientName,
        doctorName,
        department,
        appointmentDate,
        appointmentTime,
        tokenNumber,
        phoneNumber: patientPhone,
        email: patientEmail,
        appointmentId: appointment._id
      };

      const results = {
        email: { success: false, message: 'Not sent' },
        sms: { success: false, message: 'Not sent' },
        whatsapp: { success: false, message: 'Not sent' }
      };

      // Send email notification
      if (this.emailEnabled && patientEmail) {
        try {
          results.email = await this.sendBookingConfirmationEmail(appointmentData);
        } catch (error) {
          console.error('Email sending error:', error);
          results.email = { success: false, message: error.message };
        }
      }

      // Send SMS notification
      if (this.smsEnabled && patientPhone) {
        try {
          results.sms = await smsService.sendBookingConfirmation(appointmentData);
        } catch (error) {
          console.error('SMS sending error:', error);
          results.sms = { success: false, message: error.message };
        }
      }

      // Send WhatsApp notification
      if (this.whatsappEnabled && patientPhone) {
        try {
          results.whatsapp = await whatsappBotService.sendBookingConfirmation(appointmentId);
        } catch (error) {
          console.error('WhatsApp sending error:', error);
          results.whatsapp = { success: false, message: error.message };
        }
      }

      console.log('📧📱💬 Booking confirmation sent:', results);
      return results;

    } catch (error) {
      console.error('Booking confirmation notification error:', error);
      throw error;
    }
  }

  // Send appointment reminder via all enabled channels
  async sendAppointmentReminder(appointmentId) {
    try {
      const appointment = await Token.findById(appointmentId)
        .populate('patient_id', 'name email phone')
        .populate('doctor_id', 'name')
        .populate('family_member_id', 'name');

      if (!appointment) {
        throw new Error('Appointment not found');
      }

      const patientName = appointment.family_member_id ? 
        appointment.family_member_id.name : 
        appointment.patient_id.name;
      
      const doctorName = appointment.doctor_id.name;
      const appointmentDate = new Date(appointment.booking_date).toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const appointmentTime = appointment.time_slot;
      const tokenNumber = appointment.token_number;
      const patientEmail = appointment.patient_id.email;
      const patientPhone = appointment.patient_id.phone;

      const appointmentData = {
        patientName,
        doctorName,
        appointmentDate,
        appointmentTime,
        tokenNumber,
        phoneNumber: patientPhone,
        email: patientEmail,
        appointmentId: appointment._id
      };

      const results = {
        email: { success: false, message: 'Not sent' },
        sms: { success: false, message: 'Not sent' },
        whatsapp: { success: false, message: 'Not sent' }
      };

      // Send email reminder
      if (this.emailEnabled && patientEmail) {
        try {
          results.email = await this.sendAppointmentReminderEmail(appointmentData);
        } catch (error) {
          console.error('Email reminder error:', error);
          results.email = { success: false, message: error.message };
        }
      }

      // Send SMS reminder
      if (this.smsEnabled && patientPhone) {
        try {
          results.sms = await smsService.sendAppointmentReminder(appointmentData);
        } catch (error) {
          console.error('SMS reminder error:', error);
          results.sms = { success: false, message: error.message };
        }
      }

      // Send WhatsApp reminder
      if (this.whatsappEnabled && patientPhone) {
        try {
          results.whatsapp = await whatsappBotService.sendAppointmentReminder(appointmentId);
        } catch (error) {
          console.error('WhatsApp reminder error:', error);
          results.whatsapp = { success: false, message: error.message };
        }
      }

      console.log('📧📱💬 Appointment reminder sent:', results);
      return results;

    } catch (error) {
      console.error('Appointment reminder notification error:', error);
      throw error;
    }
  }

  // Send cancellation confirmation via all enabled channels
  async sendCancellationConfirmation(appointmentId, refundInfo = null) {
    try {
      const appointment = await Token.findById(appointmentId)
        .populate('patient_id', 'name email phone')
        .populate('doctor_id', 'name')
        .populate('family_member_id', 'name');

      if (!appointment) {
        throw new Error('Appointment not found');
      }

      const patientName = appointment.family_member_id ? 
        appointment.family_member_id.name : 
        appointment.patient_id.name;
      
      const doctorName = appointment.doctor_id.name;
      const appointmentDate = new Date(appointment.booking_date).toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const appointmentTime = appointment.time_slot;
      const patientEmail = appointment.patient_id.email;
      const patientPhone = appointment.patient_id.phone;

      const appointmentData = {
        patientName,
        doctorName,
        appointmentDate,
        appointmentTime,
        phoneNumber: patientPhone,
        email: patientEmail,
        appointmentId: appointment._id,
        refundInfo
      };

      const results = {
        email: { success: false, message: 'Not sent' },
        sms: { success: false, message: 'Not sent' },
        whatsapp: { success: false, message: 'Not sent' }
      };

      // Send email cancellation
      if (this.emailEnabled && patientEmail) {
        try {
          results.email = await this.sendCancellationConfirmationEmail(appointmentData);
        } catch (error) {
          console.error('Email cancellation error:', error);
          results.email = { success: false, message: error.message };
        }
      }

      // Send SMS cancellation
      if (this.smsEnabled && patientPhone) {
        try {
          results.sms = await smsService.sendCancellationConfirmation(appointmentData);
        } catch (error) {
          console.error('SMS cancellation error:', error);
          results.sms = { success: false, message: error.message };
        }
      }

      // Send WhatsApp cancellation
      if (this.whatsappEnabled && patientPhone) {
        try {
          results.whatsapp = await whatsappBotService.sendCancellationConfirmation(appointmentId, refundInfo);
        } catch (error) {
          console.error('WhatsApp cancellation error:', error);
          results.whatsapp = { success: false, message: error.message };
        }
      }

      console.log('📧📱💬 Cancellation confirmation sent:', results);
      return results;

    } catch (error) {
      console.error('Cancellation confirmation notification error:', error);
      throw error;
    }
  }

  // Email notification methods
  async sendBookingConfirmationEmail(appointmentData) {
    const {
      patientName,
      doctorName,
      department,
      appointmentDate,
      appointmentTime,
      tokenNumber,
      email
    } = appointmentData;

    const subject = `Appointment Confirmed - MediQ Hospital`;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Appointment Confirmation</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .appointment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .detail-row { display: flex; justify-content: space-between; margin: 10px 0; padding: 8px 0; border-bottom: 1px solid #eee; }
          .detail-label { font-weight: bold; color: #555; }
          .detail-value { color: #333; }
          .highlight { background: #e8f4fd; padding: 15px; border-left: 4px solid #2196F3; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
          .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
          .contact-info { background: #f0f8ff; padding: 15px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🏥 MediQ Hospital</h1>
          <h2>Appointment Confirmed</h2>
        </div>
        
        <div class="content">
          <p>Dear <strong>${patientName}</strong>,</p>
          
          <p>We are pleased to confirm your appointment has been successfully booked. Please find the details below:</p>
          
          <div class="appointment-details">
            <h3>📅 Appointment Details</h3>
            <div class="detail-row">
              <span class="detail-label">Date:</span>
              <span class="detail-value">${appointmentDate}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Time:</span>
              <span class="detail-value">${appointmentTime}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Doctor:</span>
              <span class="detail-value">Dr. ${doctorName}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Department:</span>
              <span class="detail-value">${department}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Token Number:</span>
              <span class="detail-value"><strong>#${tokenNumber}</strong></span>
            </div>
          </div>
          
          <div class="highlight">
            <strong>📋 Important Instructions:</strong>
            <ul>
              <li>Please arrive 15 minutes before your scheduled appointment time</li>
              <li>Bring a valid ID and any relevant medical documents</li>
              <li>If you need to reschedule or cancel, please contact us at least 2 hours in advance</li>
              <li>We'll send you a reminder 24 hours before your appointment</li>
            </ul>
          </div>
          
          <div class="contact-info">
            <h4>📞 Contact Information</h4>
            <p><strong>Reception:</strong> +91-9876543210</p>
            <p><strong>Emergency:</strong> +91-8589062432 or +91-9061493022</p>
            <p><strong>Website:</strong> <a href="http://localhost:5173">http://localhost:5173</a></p>
            <p><strong>Address:</strong> 123 Medical Street, Health City, PIN - 123456</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="http://localhost:5173/appointments" class="button">View My Appointments</a>
            <a href="http://localhost:5173/chatbot" class="button">Get Help</a>
          </div>
          
          <p>Thank you for choosing MediQ Hospital for your healthcare needs. We look forward to serving you!</p>
          
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
            <p>&copy; 2024 MediQ Hospital. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
      MediQ Hospital - Appointment Confirmed
      
      Dear ${patientName},
      
      Your appointment has been successfully booked:
      
      Date: ${appointmentDate}
      Time: ${appointmentTime}
      Doctor: Dr. ${doctorName}
      Department: ${department}
      Token Number: #${tokenNumber}
      
      Important Instructions:
      - Please arrive 15 minutes before your scheduled appointment time
      - Bring a valid ID and any relevant medical documents
      - If you need to reschedule or cancel, please contact us at least 2 hours in advance
      - We'll send you a reminder 24 hours before your appointment
      
      Contact Information:
      Reception: +91-9876543210
      Emergency: +91-8589062432 or +91-9061493022
      Website: http://localhost:5173
      
      Thank you for choosing MediQ Hospital!
    `;

    const mailOptions = {
      from: `"MediQ Hospital" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: subject,
      text: textContent,
      html: htmlContent
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('📧 Booking confirmation email sent:', result.messageId);
    
    return {
      success: true,
      messageId: result.messageId,
      message: 'Email sent successfully'
    };
  }

  async sendAppointmentReminderEmail(appointmentData) {
    const {
      patientName,
      doctorName,
      appointmentDate,
      appointmentTime,
      tokenNumber,
      email
    } = appointmentData;

    const subject = `Appointment Reminder - Tomorrow at ${appointmentTime}`;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Appointment Reminder</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%); color: #333; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .appointment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .reminder { background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🏥 MediQ Hospital</h1>
          <h2>Appointment Reminder</h2>
        </div>
        
        <div class="content">
          <p>Dear <strong>${patientName}</strong>,</p>
          
          <p>This is a friendly reminder about your upcoming appointment:</p>
          
          <div class="appointment-details">
            <h3>📅 Tomorrow's Appointment</h3>
            <p><strong>Date:</strong> ${appointmentDate}</p>
            <p><strong>Time:</strong> ${appointmentTime}</p>
            <p><strong>Doctor:</strong> Dr. ${doctorName}</p>
            <p><strong>Token Number:</strong> #${tokenNumber}</p>
          </div>
          
          <div class="reminder">
            <strong>⏰ Reminder:</strong> Please arrive 15 minutes early for your appointment. If you need to reschedule or cancel, please contact us as soon as possible.
          </div>
          
          <p>We look forward to seeing you tomorrow!</p>
          
          <p>Best regards,<br>MediQ Hospital Team</p>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: `"MediQ Hospital" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: subject,
      html: htmlContent
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('📧 Appointment reminder email sent:', result.messageId);
    
    return {
      success: true,
      messageId: result.messageId,
      message: 'Reminder email sent successfully'
    };
  }

  async sendCancellationConfirmationEmail(appointmentData) {
    const {
      patientName,
      doctorName,
      appointmentDate,
      appointmentTime,
      email,
      refundInfo
    } = appointmentData;

    const subject = `Appointment Cancelled - MediQ Hospital`;
    
    let refundSection = '';
    if (refundInfo && refundInfo.eligible) {
      refundSection = `
        <div class="refund-info">
          <h4>💰 Refund Information</h4>
          <p><strong>Amount:</strong> ₹${refundInfo.amount}</p>
          <p><strong>Method:</strong> ${refundInfo.method}</p>
          <p><strong>Status:</strong> ${refundInfo.status}</p>
        </div>
      `;
    }
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Appointment Cancelled</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .appointment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .refund-info { background: #e8f5e8; padding: 15px; border-left: 4px solid #4CAF50; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🏥 MediQ Hospital</h1>
          <h2>Appointment Cancelled</h2>
        </div>
        
        <div class="content">
          <p>Dear <strong>${patientName}</strong>,</p>
          
          <p>Your appointment has been successfully cancelled. Please find the details below:</p>
          
          <div class="appointment-details">
            <h3>📅 Cancelled Appointment</h3>
            <p><strong>Date:</strong> ${appointmentDate}</p>
            <p><strong>Time:</strong> ${appointmentTime}</p>
            <p><strong>Doctor:</strong> Dr. ${doctorName}</p>
          </div>
          
          ${refundSection}
          
          <p>To book a new appointment, please visit our website or contact our reception.</p>
          
          <p>Thank you for choosing MediQ Hospital!</p>
          
          <div class="footer">
            <p>Contact us: +91-9876543210 | <a href="http://localhost:5173">http://localhost:5173</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: `"MediQ Hospital" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: subject,
      html: htmlContent
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('📧 Cancellation confirmation email sent:', result.messageId);
    
    return {
      success: true,
      messageId: result.messageId,
      message: 'Cancellation email sent successfully'
    };
  }

  // Test all notification services
  async testAllServices() {
    const results = {
      email: { enabled: this.emailEnabled, status: 'Not tested' },
      sms: { enabled: this.smsEnabled, status: 'Not tested' },
      whatsapp: { enabled: this.whatsappEnabled, status: 'Not tested' }
    };

    // Test email
    if (this.emailEnabled) {
      try {
        await transporter.verify();
        results.email.status = 'Ready';
      } catch (error) {
        results.email.status = `Error: ${error.message}`;
      }
    }

    // Test SMS
    if (this.smsEnabled) {
      try {
        const smsTest = await smsService.testConfiguration();
        results.sms.status = smsTest ? 'Ready' : 'Configuration error';
      } catch (error) {
        results.sms.status = `Error: ${error.message}`;
      }
    }

    // Test WhatsApp
    if (this.whatsappEnabled) {
      results.whatsapp.status = 'Ready (API configured)';
    }

    console.log('🔔 Notification Services Status:', results);
    return results;
  }
}

module.exports = new NotificationService();