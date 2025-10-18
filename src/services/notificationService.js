const { transporter } = require('../config/email');
const smsService = require('./smsService');
const whatsappBotService = require('./whatsappBotService');
const { User, Token } = require('../models/User');
const Notification = require('../models/Notification');

class NotificationService {
  constructor() {
    this.emailEnabled = process.env.EMAIL_USER && process.env.EMAIL_PASS;
    this.smsEnabled = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN;
    this.whatsappEnabled = process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID;
  }

  // Create in-app notification
  async createNotification(data) {
    try {
      console.log('🔔 Creating notification with data:', data);
      const notification = await Notification.createNotification(data);
      console.log('🔔 In-app notification created successfully:', notification._id);
      return notification;
    } catch (error) {
      console.error('❌ Error creating notification:', error);
      throw error;
    }
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

      // Create in-app notification for doctor
      try {
        await this.createNotification({
          recipient_id: appointment.doctor_id._id,
          recipient_type: 'doctor',
          title: 'New Appointment Booked',
          message: `${patientName} has booked an appointment for ${appointmentDate} at ${appointmentTime}`,
          type: 'appointment',
          priority: 'normal',
          related_id: appointment._id,
          related_type: 'appointment',
          metadata: {
            patientName,
            appointmentDate,
            appointmentTime,
            tokenNumber,
            department
          }
        });
      } catch (notificationError) {
        console.error('Error creating doctor notification:', notificationError);
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

  // Send leave-related appointment cancellation via all enabled channels
  async sendLeaveCancellationNotification(appointmentId, leaveInfo) {
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
        leaveInfo
      };

      const results = {
        email: { success: false, message: 'Not sent' },
        sms: { success: false, message: 'Not sent' },
        whatsapp: { success: false, message: 'Not sent' }
      };

      // Send email notification
      if (this.emailEnabled && patientEmail) {
        try {
          results.email = await this.sendLeaveCancellationEmail(appointmentData);
        } catch (error) {
          console.error('Email leave cancellation error:', error);
          results.email = { success: false, message: error.message };
        }
      }

      // Send SMS notification
      if (this.smsEnabled && patientPhone) {
        try {
          results.sms = await smsService.sendLeaveCancellation(appointmentData);
        } catch (error) {
          console.error('SMS leave cancellation error:', error);
          results.sms = { success: false, message: error.message };
        }
      }

      // Send WhatsApp notification
      if (this.whatsappEnabled && patientPhone) {
        try {
          results.whatsapp = await whatsappBotService.sendLeaveCancellation(appointmentId, leaveInfo);
        } catch (error) {
          console.error('WhatsApp leave cancellation error:', error);
          results.whatsapp = { success: false, message: error.message };
        }
      }

      console.log('📧📱💬 Leave cancellation notification sent:', results);
      return results;

    } catch (error) {
      console.error('Leave cancellation notification error:', error);
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

  async sendLeaveCancellationEmail(appointmentData) {
    const {
      patientName,
      doctorName,
      appointmentDate,
      appointmentTime,
      email,
      leaveInfo
    } = appointmentData;

    const subject = `Appointment Cancelled - Doctor Leave - MediQ Hospital`;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Appointment Cancelled - Doctor Leave</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .appointment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .leave-info { background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
          .alternative { background: #e8f4fd; padding: 15px; border-left: 4px solid #2196F3; margin: 20px 0; }
          .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🏥 MediQ Hospital</h1>
          <h2>Appointment Cancelled - Doctor Leave</h2>
        </div>
        
        <div class="content">
          <p>Dear <strong>${patientName}</strong>,</p>
          
          <p>We regret to inform you that your appointment has been cancelled due to Dr. ${doctorName}'s approved leave.</p>
          
          <div class="appointment-details">
            <h3>📅 Cancelled Appointment</h3>
            <p><strong>Date:</strong> ${appointmentDate}</p>
            <p><strong>Time:</strong> ${appointmentTime}</p>
            <p><strong>Doctor:</strong> Dr. ${doctorName}</p>
          </div>
          
          <div class="leave-info">
            <h4>📋 Leave Information</h4>
            <p><strong>Reason:</strong> ${leaveInfo.reason || 'Doctor leave'}</p>
            <p><strong>Leave Type:</strong> ${leaveInfo.leave_type === 'full_day' ? 'Full Day' : 'Half Day'}</p>
            ${leaveInfo.leave_type === 'half_day' ? `<p><strong>Session:</strong> ${leaveInfo.session} session</p>` : ''}
          </div>
          
          <div class="alternative">
            <h4>🔄 Next Steps</h4>
            <p>We apologize for any inconvenience caused. Here are your options:</p>
            <ul>
              <li><strong>Reschedule:</strong> Book a new appointment with Dr. ${doctorName} for a later date</li>
              <li><strong>Alternative Doctor:</strong> Choose another doctor from the same department</li>
              <li><strong>Refund:</strong> Request a full refund if you prefer not to reschedule</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="http://localhost:5173/booking" class="button">Book New Appointment</a>
            <a href="http://localhost:5173/contact" class="button">Contact Us</a>
          </div>
          
          <p>We sincerely apologize for this inconvenience and appreciate your understanding.</p>
          
          <div class="footer">
            <p>Contact us: +91-9876543210 | <a href="http://localhost:5173">http://localhost:5173</a></p>
            <p>&copy; 2024 MediQ Hospital. All rights reserved.</p>
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
    console.log('📧 Leave cancellation email sent:', result.messageId);
    
    return {
      success: true,
      messageId: result.messageId,
      message: 'Leave cancellation email sent successfully'
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

  // Send refund notification email
  async sendRefundNotification(refundData) {
    const { patientName, patientEmail, amount, reason, appointmentDate, doctorName } = refundData;
    
    if (!patientEmail) {
      console.log('📧 Refund notification skipped - no email provided');
      return { success: true, message: 'Refund notification skipped - no email' };
    }

    const subject = `Refund Processed - MediQ Hospital`;
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Refund Processed</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; margin: -20px -20px 20px -20px; }
          .header h1 { margin: 0; font-size: 28px; }
          .header h2 { margin: 10px 0 0 0; font-size: 18px; opacity: 0.9; }
          .content { padding: 20px 0; }
          .refund-details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745; }
          .refund-amount { font-size: 24px; font-weight: bold; color: #28a745; text-align: center; margin: 15px 0; }
          .detail-row { display: flex; justify-content: space-between; margin: 10px 0; padding: 8px 0; border-bottom: 1px solid #eee; }
          .detail-label { font-weight: bold; color: #666; }
          .detail-value { color: #333; }
          .reason-box { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 15px 0; }
          .next-steps { background: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .next-steps h4 { color: #0066cc; margin-top: 0; }
          .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 5px; font-weight: bold; }
          .button:hover { background: #0056b3; }
          .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏥 MediQ Hospital</h1>
            <h2>Refund Processed Successfully</h2>
          </div>
          
          <div class="content">
            <p>Dear <strong>${patientName}</strong>,</p>
            <p>We have successfully processed your refund request. Please find the details below:</p>
            
            <div class="refund-details">
              <h3>💰 Refund Details</h3>
              <div class="refund-amount">₹${amount}</div>
              
              <div class="detail-row">
                <span class="detail-label">Appointment Date:</span>
                <span class="detail-value">${new Date(appointmentDate).toLocaleDateString()}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Doctor:</span>
                <span class="detail-value">Dr. ${doctorName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Refund Date:</span>
                <span class="detail-value">${new Date().toLocaleDateString()}</span>
              </div>
            </div>
            
            <div class="reason-box">
              <h4>📋 Refund Reason</h4>
              <p>${reason}</p>
            </div>
            
            <div class="next-steps">
              <h4>🔄 Next Steps</h4>
              <p>Your refund has been processed and will be credited to your account within 3-5 business days.</p>
              <ul>
                <li><strong>Original Payment Method:</strong> The refund will be credited to your original payment method</li>
                <li><strong>Processing Time:</strong> 3-5 business days</li>
                <li><strong>Contact Support:</strong> If you have any questions, please contact our support team</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="http://localhost:5173/appointments" class="button">View My Appointments</a>
              <a href="http://localhost:5173/contact" class="button">Contact Support</a>
            </div>
            
            <p>We apologize for any inconvenience caused and appreciate your understanding.</p>
            
            <div class="footer">
              <p>Contact us: +91-9876543210 | <a href="http://localhost:5173">http://localhost:5173</a></p>
              <p>&copy; 2024 MediQ Hospital. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: `"MediQ Hospital" <${process.env.EMAIL_USER}>`,
      to: patientEmail,
      subject: subject,
      html: htmlContent
    };

    try {
      const result = await transporter.sendMail(mailOptions);
      console.log('📧 Refund notification email sent:', result.messageId);
      return { success: true, messageId: result.messageId, message: 'Refund notification email sent successfully' };
    } catch (error) {
      console.error('❌ Error sending refund notification email:', error);
      return { success: false, error: error.message, message: 'Failed to send refund notification email' };
    }
  }

  // Send admin message notification
  async sendAdminMessage(messageData) {
    const { recipientName, recipientEmail, subject, message, type, priority } = messageData;
    
    if (!recipientEmail) {
      console.log('📧 Admin message skipped - no email provided');
      return { success: true, message: 'Admin message skipped - no email' };
    }

    const typeConfig = {
      notification: { icon: '🔔', title: 'Notification from MediQ Hospital' },
      announcement: { icon: '📢', title: 'Important Announcement - MediQ Hospital' },
      reminder: { icon: '⏰', title: 'Reminder from MediQ Hospital' },
      alert: { icon: '⚠️', title: 'Alert from MediQ Hospital' }
    };

    const config = typeConfig[type] || typeConfig.notification;
    const priorityColor = priority === 'urgent' ? '#dc2626' : priority === 'high' ? '#ea580c' : '#059669';

    const subject_line = `${config.icon} ${subject}`;
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${config.title}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; margin: -20px -20px 20px -20px; }
          .header h1 { margin: 0; font-size: 28px; }
          .header h2 { margin: 10px 0 0 0; font-size: 18px; opacity: 0.9; }
          .content { padding: 20px 0; }
          .message-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${priorityColor}; }
          .priority-badge { display: inline-block; background: ${priorityColor}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-bottom: 10px; }
          .type-badge { display: inline-block; background: #6b7280; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-left: 10px; }
          .message-content { background: white; padding: 20px; border-radius: 8px; margin: 15px 0; border: 1px solid #e5e7eb; }
          .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 12px; }
          .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 5px; font-weight: bold; }
          .button:hover { background: #0056b3; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏥 MediQ Hospital</h1>
            <h2>${config.title}</h2>
          </div>
          
          <div class="content">
            <p>Dear <strong>${recipientName}</strong>,</p>
            
            <div class="message-box">
              <div>
                <span class="priority-badge">${priority.toUpperCase()}</span>
                <span class="type-badge">${type.toUpperCase()}</span>
              </div>
              <h3 style="margin: 10px 0; color: #374151;">${subject}</h3>
            </div>
            
            <div class="message-content">
              <p style="white-space: pre-wrap; margin: 0;">${message}</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="http://localhost:5173/appointments" class="button">View My Appointments</a>
              <a href="http://localhost:5173/contact" class="button">Contact Support</a>
            </div>
            
            <p>Thank you for choosing MediQ Hospital for your healthcare needs.</p>
            
            <div class="footer">
              <p>Contact us: +91-9876543210 | <a href="http://localhost:5173">http://localhost:5173</a></p>
              <p>&copy; 2024 MediQ Hospital. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: `"MediQ Hospital" <${process.env.EMAIL_USER}>`,
      to: recipientEmail,
      subject: subject_line,
      html: htmlContent
    };

    try {
      const result = await transporter.sendMail(mailOptions);
      console.log('📧 Admin message sent:', result.messageId);
      return { success: true, messageId: result.messageId, message: 'Admin message sent successfully' };
    } catch (error) {
      console.error('❌ Error sending admin message:', error);
      return { success: false, error: error.message, message: 'Failed to send admin message' };
    }
  }

  // Create leave request approval notification
  async createLeaveApprovalNotification(leaveRequest) {
    try {
      const notification = await this.createNotification({
        recipient_id: leaveRequest.doctor_id,
        recipient_type: 'doctor',
        title: 'Leave Request Approved',
        message: `Your leave request for ${new Date(leaveRequest.start_date).toLocaleDateString()} has been approved`,
        type: 'leave_request',
        priority: 'normal',
        related_id: leaveRequest._id,
        related_type: 'leave_request',
        metadata: {
          leaveType: leaveRequest.leave_type,
          startDate: leaveRequest.start_date,
          endDate: leaveRequest.end_date,
          reason: leaveRequest.reason,
          status: leaveRequest.status
        }
      });
      return notification;
    } catch (error) {
      console.error('Error creating leave approval notification:', error);
      throw error;
    }
  }

  // Create leave request rejection notification
  async createLeaveRejectionNotification(leaveRequest) {
    try {
      const notification = await this.createNotification({
        recipient_id: leaveRequest.doctor_id,
        recipient_type: 'doctor',
        title: 'Leave Request Rejected',
        message: `Your leave request for ${new Date(leaveRequest.start_date).toLocaleDateString()} has been rejected`,
        type: 'leave_request',
        priority: 'normal',
        related_id: leaveRequest._id,
        related_type: 'leave_request',
        metadata: {
          leaveType: leaveRequest.leave_type,
          startDate: leaveRequest.start_date,
          endDate: leaveRequest.end_date,
          reason: leaveRequest.reason,
          status: leaveRequest.status
        }
      });
      return notification;
    } catch (error) {
      console.error('Error creating leave rejection notification:', error);
      throw error;
    }
  }

  // Create appointment cancellation notification for doctor
  async createAppointmentCancellationNotification(appointment, cancellationReason) {
    try {
      const patientName = appointment.family_member_id ? 
        appointment.family_member_id.name : 
        appointment.patient_id.name;
      
      const notification = await this.createNotification({
        recipient_id: appointment.doctor_id,
        recipient_type: 'doctor',
        title: 'Appointment Cancelled',
        message: `Appointment with ${patientName} on ${new Date(appointment.booking_date).toLocaleDateString()} has been cancelled`,
        type: 'cancellation',
        priority: 'normal',
        related_id: appointment._id,
        related_type: 'appointment',
        metadata: {
          patientName,
          appointmentDate: appointment.booking_date,
          appointmentTime: appointment.time_slot,
          cancellationReason
        }
      });
      return notification;
    } catch (error) {
      console.error('Error creating appointment cancellation notification:', error);
      throw error;
    }
  }
}

module.exports = new NotificationService();