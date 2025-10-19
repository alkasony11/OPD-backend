const chatbotService = require('./chatbotService');
const { User, Token } = require('../models/User');
const Department = require('../models/Department');

class WhatsAppBotService {
  constructor() {
    this.webhookUrl = process.env.WHATSAPP_WEBHOOK_URL || 'https://your-webhook-url.com/webhook';
    this.verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'your-verify-token';
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
      
      // Handle different message types
      if (type === 'text') {
        return await this.handleTextMessage(from, text.body);
      } else if (type === 'button') {
        return await this.handleButtonMessage(from, text);
      } else if (type === 'interactive') {
        return await this.handleInteractiveMessage(from, text);
      } else {
        return this.sendMessage(from, 
          "I can process text messages and quick replies. Please send a text message or use the quick reply buttons."
        );
      }
    } catch (error) {
      console.error('WhatsApp bot error:', error);
      return this.sendMessage(messageData.from, 
        "I'm sorry, I encountered an error. Please try again or contact our support team."
      );
    }
  }

  // Handle text messages
  async handleTextMessage(from, messageText) {
    // Clean phone number
    const cleanPhone = from.replace('whatsapp:', '');
    
    // Find user by phone number
    const user = await User.findOne({ 
      phone: cleanPhone,
      role: 'patient'
    });

    if (!user) {
      return this.sendMessage(from, 
        "🏥 *Welcome to MediQ Hospital!*\n\n" +
        "I couldn't find your account with this phone number.\n\n" +
        "To get started:\n" +
        "• Register: http://localhost:5173/register\n" +
        "• Call Reception: +91-9876543210\n" +
        "• Visit: 123 Medical Street, Health City\n\n" +
        "Once registered, I can help you with:\n" +
        "• Booking appointments\n" +
        "• Managing your visits\n" +
        "• Hospital information\n" +
        "• Emergency contacts\n\n" +
        "Type *Help* anytime for assistance! 😊"
      );
    }

    // Process message through chatbot service
    const response = await chatbotService.processMessage(user._id, messageText);
    
    // Send response back to WhatsApp
    return this.sendMessage(from, response.message);
  }

  // Handle button messages (quick replies)
  async handleButtonMessage(from, buttonData) {
    const cleanPhone = from.replace('whatsapp:', '');
    const user = await User.findOne({ phone: cleanPhone, role: 'patient' });
    
    if (!user) {
      return this.sendMessage(from, "Please register first to use quick actions.");
    }

    const buttonText = buttonData.payload || buttonData.text;
    
    switch (buttonText) {
      case 'BOOK_APPOINTMENT':
        return this.sendMessage(from, 
          "📅 *Book Appointment*\n\n" +
          "To book a new appointment:\n" +
          "1. Visit: http://localhost:5173/booking\n" +
          "2. Call: +91-9876543210\n" +
          "3. Reply with: *Book* for guided booking\n\n" +
          "What department do you need?"
        );
      
      case 'MY_APPOINTMENTS':
        return await this.handleTextMessage(from, "my appointments");
      
      case 'HOSPITAL_INFO':
        return await this.handleTextMessage(from, "hospital information");
      
      case 'EMERGENCY':
        return await this.handleTextMessage(from, "emergency");
      
      case 'HELP':
        return await this.handleTextMessage(from, "help");
      
      default:
        return this.sendMessage(from, "I didn't understand that option. Please try again or type *Help*.");
    }
  }

  // Handle interactive messages (list selections, etc.)
  async handleInteractiveMessage(from, interactiveData) {
    // Handle list selections, quick replies, etc.
    const cleanPhone = from.replace('whatsapp:', '');
    const user = await User.findOne({ phone: cleanPhone, role: 'patient' });
    
    if (!user) {
      return this.sendMessage(from, "Please register first to use interactive features.");
    }

    // Process based on interactive type
    if (interactiveData.list_reply) {
      return this.handleListSelection(from, interactiveData.list_reply);
    } else if (interactiveData.button_reply) {
      return this.handleButtonMessage(from, interactiveData.button_reply);
    }

    return this.sendMessage(from, "I didn't understand that selection. Please try again.");
  }

  // Handle list selections
  async handleListSelection(from, listData) {
    const selection = listData.title;
    
    // Handle department selection for booking
    if (selection.includes('Cardiology') || selection.includes('Neurology') || 
        selection.includes('Orthopedics') || selection.includes('General Medicine')) {
      return this.sendMessage(from, 
        `Great choice! You selected *${selection}*.\n\n` +
        "To book an appointment:\n" +
        "1. Visit: http://localhost:5173/booking\n" +
        "2. Select this department\n" +
        "3. Choose your preferred doctor and time\n\n" +
        "Or call +91-9876543210 for assistance."
      );
    }

    return this.sendMessage(from, `You selected: ${selection}. How can I help you with this?`);
  }

  // Send message to WhatsApp
  async sendMessage(to, message) {
    try {
      console.log(`WhatsApp message to ${to}: ${message}`);
      
      // Check if we have WhatsApp API credentials
      if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
        console.log('WhatsApp API not configured - message logged only');
        return {
          messaging_product: "whatsapp",
          to: to,
          type: "text",
          text: { body: message },
          status: 'logged_only'
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
      const result = await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(response)
      });

      const responseData = await result.json();
      
      if (!result.ok) {
        console.error('WhatsApp API Error:', responseData);
        throw new Error(`WhatsApp API Error: ${responseData.error?.message || 'Unknown error'}`);
      }

      console.log('WhatsApp message sent successfully:', responseData);
      return responseData;
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
      
      // Fallback: log the message for manual sending
      console.log('FALLBACK - Message to be sent manually:');
      console.log(`To: ${to}`);
      console.log(`Message: ${message}`);
      
      throw error;
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
      `• Website: http://localhost:5173\n\n` +
      `Need more specific information? Just ask!`;

    return await this.sendMessage(`whatsapp:${phoneNumber}`, message);
  }

  // Send interactive message with buttons
  async sendInteractiveMessage(phoneNumber, message, buttons = []) {
    try {
      // Default quick reply buttons if none provided
      const defaultButtons = [
        { id: 'BOOK_APPOINTMENT', title: '📅 Book Appointment' },
        { id: 'MY_APPOINTMENTS', title: '📋 My Appointments' },
        { id: 'HOSPITAL_INFO', title: '🏥 Hospital Info' },
        { id: 'EMERGENCY', title: '🚨 Emergency' },
        { id: 'HELP', title: '❓ Help' }
      ];

      const quickReplyButtons = buttons.length > 0 ? buttons : defaultButtons;

      const response = {
        messaging_product: "whatsapp",
        to: phoneNumber.replace('whatsapp:', ''),
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: message
          },
          action: {
            buttons: quickReplyButtons.map(button => ({
              type: "reply",
              reply: {
                id: button.id,
                title: button.title
              }
            }))
          }
        }
      };

      // Check if we have WhatsApp API credentials
      if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
        console.log('WhatsApp API not configured - interactive message logged only');
        return {
          ...response,
          status: 'logged_only'
        };
      }

      // Make actual API call to WhatsApp Cloud API
      const result = await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(response)
      });

      const responseData = await result.json();
      
      if (!result.ok) {
        console.error('WhatsApp Interactive API Error:', responseData);
        throw new Error(`WhatsApp API Error: ${responseData.error?.message || 'Unknown error'}`);
      }

      console.log('WhatsApp interactive message sent successfully:', responseData);
      return responseData;
    } catch (error) {
      console.error('Error sending interactive WhatsApp message:', error);
      throw error;
    }
  }

  // Send welcome message with quick actions
  async sendWelcomeMessage(phoneNumber) {
    const message = `🏥 *Welcome to MediQ Hospital!*\n\n` +
      `I'm your personal healthcare assistant. I can help you with:\n\n` +
      `• Booking and managing appointments\n` +
      `• Checking your queue status\n` +
      `• Hospital information and timings\n` +
      `• Emergency contacts\n` +
      `• And much more!\n\n` +
      `How can I assist you today?`;

    return await this.sendInteractiveMessage(phoneNumber, message);
  }

  // Send department list for booking
  async sendDepartmentList(phoneNumber) {
    const message = `🏥 *Choose a Department*\n\n` +
      `Select the department you need to book an appointment for:`;

    const departments = [
      { id: 'CARDIOLOGY', title: '🫀 Cardiology' },
      { id: 'NEUROLOGY', title: '🧠 Neurology' },
      { id: 'ORTHOPEDICS', title: '🦴 Orthopedics' },
      { id: 'PEDIATRICS', title: '👶 Pediatrics' },
      { id: 'GYNECOLOGY', title: '👩 Gynecology' },
      { id: 'DERMATOLOGY', title: '🧴 Dermatology' },
      { id: 'GENERAL_MEDICINE', title: '🩺 General Medicine' },
      { id: 'EMERGENCY', title: '🚨 Emergency' }
    ];

    return await this.sendInteractiveMessage(phoneNumber, message, departments);
  }
}

module.exports = new WhatsAppBotService();

