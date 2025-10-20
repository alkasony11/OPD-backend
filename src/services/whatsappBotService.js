const chatbotService = require('./chatbotService');
const { User, Token } = require('../models/User');
const Department = require('../models/Department');

class WhatsAppBotService {
  constructor() {
    this.webhookUrl = process.env.WHATSAPP_WEBHOOK_URL || 'https://your-webhook-url.com/webhook';
    this.verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'your-verify-token';
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.isConfigured = !!(this.accessToken && this.phoneNumberId);
    
    if (this.isConfigured) {
      console.log('✅ WhatsApp Cloud API configured - Bot will send real messages');
    } else {
      console.log('⚠️  WhatsApp Cloud API not configured - Bot will log messages only');
      console.log('   To enable real messaging, add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to your .env file');
    }
  }

  // Verify webhook for WhatsApp
  verifyWebhook(mode, token, challenge) {
    if (mode === 'subscribe' && token === this.verifyToken) {
      return challenge;
    }
    return null;
  }

  // Process incoming WhatsApp messages
  async processMessage(messageData) {
    try {
      const { from, text, type } = messageData;
      
      if (type !== 'text') {
        return this.sendMessage(from, "I can only process text messages. Please send a text message.");
      }

      // Find user by phone number
      const user = await User.findOne({ 
        phone: from.replace('whatsapp:', ''),
        role: 'patient'
      });

      if (!user) {
        return this.sendMessage(from, 
          "Welcome to MediQ Hospital! I couldn't find your account. " +
          "Please register on our website or contact our reception for assistance. " +
          `Visit: ${process.env.FRONTEND_URL || 'http://localhost:5173'}/register`
        );
      }

      // Process message through chatbot service
      const response = await chatbotService.processMessage(user._id, text.body);
      
      // Send response back to WhatsApp
      return this.sendMessage(from, response.message);
    } catch (error) {
      console.error('WhatsApp bot error:', error);
      return this.sendMessage(messageData.from, 
        "I'm sorry, I encountered an error. Please try again or contact our support team."
      );
    }
  }

  // Send message to WhatsApp
  async sendMessage(to, message) {
    try {
      console.log(`WhatsApp message to ${to}: ${message}`);
      
      // Check if we have WhatsApp API credentials
      if (!this.isConfigured) {
        console.log('⚠️  WhatsApp API not configured - message logged only');
        console.log('   To enable real messaging, add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to your .env file');
        return {
          messaging_product: "whatsapp",
          to: to,
          type: "text",
          text: { body: message },
          status: 'logged_only',
          note: 'Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to .env for real messaging'
        };
      }

      // Clean phone number (remove whatsapp: prefix if present)
      const cleanPhoneNumber = to.replace('whatsapp:', '');
      
      const response = {
        messaging_product: "whatsapp",
        to: cleanPhoneNumber,
        type: "text",
        text: {
          body: message
        }
      };

      // Make actual API call to WhatsApp Cloud API
      const result = await fetch(`https://graph.facebook.com/v18.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(response)
      });

      const responseData = await result.json();
      
      if (!result.ok) {
        console.error('❌ WhatsApp API Error:', responseData);
        throw new Error(`WhatsApp API Error: ${responseData.error?.message || 'Unknown error'}`);
      }

      console.log('✅ WhatsApp message sent successfully:', responseData);
      return responseData;
    } catch (error) {
      console.error('❌ Error sending WhatsApp message:', error);
      
      // Fallback: log the message for manual sending
      console.log('📝 FALLBACK - Message to be sent manually:');
      console.log(`📱 To: ${to}`);
      console.log(`💬 Message: ${message}`);
      
      return {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message },
        status: 'error',
        error: error.message
      };
    }
  }

  // Send appointment reminders
  async sendAppointmentReminder(appointmentId) {
    try {
      const appointment = await Token.findById(appointmentId)
        .populate('patient_id', 'name phone')
        .populate('doctor_id', 'name')
        .populate('family_member_id', 'name');

      if (!appointment || !appointment.patient_id.phone) {
        return;
      }

      const patientName = appointment.family_member_id ? 
        appointment.family_member_id.name : 
        appointment.patient_id.name;
      
      const doctorName = appointment.doctor_id.name;
      const appointmentDate = new Date(appointment.booking_date).toLocaleDateString();
      const appointmentTime = appointment.time_slot;
      const tokenNumber = appointment.token_number;

      const message = `🏥 *MediQ Hospital Reminder*\n\n` +
        `Hello ${patientName},\n\n` +
        `Your appointment is scheduled for:\n` +
        `📅 Date: ${appointmentDate}\n` +
        `🕐 Time: ${appointmentTime}\n` +
        `👨‍⚕️ Doctor: Dr. ${doctorName}\n` +
        `🎫 Token: #${tokenNumber}\n\n` +
        `Please arrive 15 minutes early.\n\n` +
        `To reschedule or cancel, reply with:\n` +
        `• "Reschedule" - to change your appointment\n` +
        `• "Cancel" - to cancel your appointment\n` +
        `• "Status" - to check your queue status\n\n` +
        `Need help? Just type "Help" or visit our website.`;

      return await this.sendMessage(`whatsapp:${appointment.patient_id.phone}`, message);
    } catch (error) {
      console.error('Error sending appointment reminder:', error);
    }
  }

  // Send booking confirmation
  async sendBookingConfirmation(appointmentId) {
    try {
      const appointment = await Token.findById(appointmentId)
        .populate('patient_id', 'name phone')
        .populate('doctor_id', 'name')
        .populate('family_member_id', 'name');

      if (!appointment || !appointment.patient_id.phone) {
        return;
      }

      const patientName = appointment.family_member_id ? 
        appointment.family_member_id.name : 
        appointment.patient_id.name;
      
      const doctorName = appointment.doctor_id.name;
      const appointmentDate = new Date(appointment.booking_date).toLocaleDateString();
      const appointmentTime = appointment.time_slot;
      const tokenNumber = appointment.token_number;
      const department = appointment.department;

      const message = `✅ *Appointment Confirmed!*\n\n` +
        `Hello ${patientName},\n\n` +
        `Your appointment has been successfully booked:\n\n` +
        `📅 Date: ${appointmentDate}\n` +
        `🕐 Time: ${appointmentTime}\n` +
        `👨‍⚕️ Doctor: Dr. ${doctorName}\n` +
        `🏥 Department: ${department}\n` +
        `🎫 Token: #${tokenNumber}\n\n` +
        `We'll send you a reminder 24 hours before your appointment.\n\n` +
        `To manage your appointment, reply with:\n` +
        `• "My Appointments" - to view all appointments\n` +
        `• "Reschedule" - to change this appointment\n` +
        `• "Cancel" - to cancel this appointment\n\n` +
        `Need help? Just type "Help" or visit our website.`;

      return await this.sendMessage(`whatsapp:${appointment.patient_id.phone}`, message);
    } catch (error) {
      console.error('Error sending booking confirmation:', error);
    }
  }

  // Send cancellation confirmation
  async sendCancellationConfirmation(appointmentId, refundInfo = null) {
    try {
      const appointment = await Token.findById(appointmentId)
        .populate('patient_id', 'name phone')
        .populate('doctor_id', 'name')
        .populate('family_member_id', 'name');

      if (!appointment || !appointment.patient_id.phone) {
        return;
      }

      const patientName = appointment.family_member_id ? 
        appointment.family_member_id.name : 
        appointment.patient_id.name;
      
      const doctorName = appointment.doctor_id.name;
      const appointmentDate = new Date(appointment.booking_date).toLocaleDateString();
      const appointmentTime = appointment.time_slot;

      let message = `❌ *Appointment Cancelled*\n\n` +
        `Hello ${patientName},\n\n` +
        `Your appointment has been cancelled:\n\n` +
        `📅 Date: ${appointmentDate}\n` +
        `🕐 Time: ${appointmentTime}\n` +
        `👨‍⚕️ Doctor: Dr. ${doctorName}\n\n`;

      if (refundInfo && refundInfo.eligible) {
        message += `💰 Refund Information:\n` +
          `Amount: ₹${refundInfo.amount}\n` +
          `Method: ${refundInfo.method}\n` +
          `Status: ${refundInfo.status}\n\n`;
      }

      message += `To book a new appointment, reply with:\n` +
        `• "Book Appointment" - to schedule a new visit\n` +
        `• "My Appointments" - to view all appointments\n\n` +
        `Need help? Just type "Help" or visit our website.`;

      return await this.sendMessage(`whatsapp:${appointment.patient_id.phone}`, message);
    } catch (error) {
      console.error('Error sending cancellation confirmation:', error);
    }
  }

  // Send queue status update
  async sendQueueUpdate(appointmentId, queuePosition, estimatedWaitTime) {
    try {
      const appointment = await Token.findById(appointmentId)
        .populate('patient_id', 'name phone')
        .populate('doctor_id', 'name')
        .populate('family_member_id', 'name');

      if (!appointment || !appointment.patient_id.phone) {
        return;
      }

      const patientName = appointment.family_member_id ? 
        appointment.family_member_id.name : 
        appointment.patient_id.name;
      
      const doctorName = appointment.doctor_id.name;
      const tokenNumber = appointment.token_number;

      const message = `📊 *Queue Update*\n\n` +
        `Hello ${patientName},\n\n` +
        `Your current queue status:\n\n` +
        `👨‍⚕️ Doctor: Dr. ${doctorName}\n` +
        `🎫 Token: #${tokenNumber}\n` +
        `📍 Position: ${queuePosition}\n` +
        `⏱️ Estimated Wait: ${estimatedWaitTime} minutes\n\n` +
        `Please wait in the waiting area. We'll notify you when it's your turn.\n\n` +
        `To check status again, reply with "Status"`;

      return await this.sendMessage(`whatsapp:${appointment.patient_id.phone}`, message);
    } catch (error) {
      console.error('Error sending queue update:', error);
    }
  }

  // Send emergency contact information
  async sendEmergencyInfo(phoneNumber) {
    const message = `🚨 *EMERGENCY CONTACTS* 🚨\n\n` +
      `**Immediate Emergency:**\n` +
      `• Call: +91-8589062432 or +91-9061493022\n` +
      `• Visit: Emergency Department (24/7)\n` +
      `• Location: Ground Floor, Main Building\n\n` +
      `**Ambulance Service:**\n` +
      `• Call: 108 (Government)\n` +
      `• Call: +91-9876543211 (Private)\n\n` +
      `**For non-emergency medical advice:**\n` +
      `• Call: +91-9876543212\n` +
      `• Available: 24/7\n\n` +
      `If this is a life-threatening emergency, please call emergency services immediately!`;

    return await this.sendMessage(`whatsapp:${phoneNumber}`, message);
  }

  // Send hospital information
  async sendHospitalInfo(phoneNumber) {
    const message = `🏥 *MediQ Hospital Information*\n\n` +
      `**OPD Timings:**\n` +
      `• Morning: 9:00 AM - 1:00 PM\n` +
      `• Afternoon: 2:00 PM - 6:00 PM\n` +
      `• Emergency: 24/7\n\n` +
      `**Departments:**\n` +
      `• Cardiology, Neurology, Orthopedics\n` +
      `• Pediatrics, Gynecology, Dermatology\n` +
      `• Ophthalmology, ENT, General Medicine\n\n` +
      `**Location:**\n` +
      `123 Medical Street, Health City\n` +
      `PIN - 123456\n\n` +
      `**Contact:**\n` +
      `• Reception: +91-9876543210\n` +
      `• Emergency: +91-8589062432 or +91-9061493022\n` +
      `• Website: ${process.env.FRONTEND_URL || 'http://localhost:5173'}\n\n` +
      `Need more specific information? Just ask!`;

    return await this.sendMessage(`whatsapp:${phoneNumber}`, message);
  }
}

module.exports = new WhatsAppBotService();

