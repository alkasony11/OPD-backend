const { User, Token } = require('../models/User');
const Department = require('../models/Department');
const FamilyMember = require('../models/FamilyMember');
const DoctorSchedule = require('../models/DoctorSchedule');

class ChatbotService {
  constructor() {
    this.conversationStates = new Map(); // Store conversation states
    this.faqData = this.initializeFAQ();
  }

  initializeFAQ() {
    return {
      departments: "We have the following departments: Cardiology, Neurology, Orthopedics, Pediatrics, Gynecology, Dermatology, Ophthalmology, ENT, General Medicine, and Emergency Medicine.",
      timings: "Our OPD timings are: Morning Session: 9:00 AM - 1:00 PM, Afternoon Session: 2:00 PM - 6:00 PM, Emergency: 24/7",
      emergency: "For emergencies, please call our emergency numbers: +91-8589062432 or +91-9061493022. You can also visit our emergency department which is open 24/7.",
      booking: "You can book appointments through our patient portal, mobile app, or by calling our reception at +91-9876543210.",
      payment: "We accept cash, card payments, UPI, and digital wallets. Payment can be made at the time of consultation or in advance through our portal.",
      location: "We are located at 123 Medical Street, Health City, PIN - 123456. You can reach us by metro (nearest station: Health City Metro) or by bus.",
      parking: "Yes, we have free parking available for patients and visitors. The parking area is located in the basement of the building.",
      documents: "Please bring your Aadhaar card, any previous medical reports, current medications list, and insurance card (if applicable).",
      cancellation: "You can cancel your appointment up to 2 hours before the scheduled time. Cancellations can be done through the portal, app, or by calling reception.",
      reschedule: "You can reschedule your appointment through our patient portal or by calling reception. Please reschedule at least 2 hours before your current appointment time."
    };
  }

  async processMessage(userId, message, context = {}) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        return this.createResponse("I'm sorry, I couldn't find your account. Please log in again.", 'error');
      }

      const conversationState = this.getConversationState(userId);
      
      // Check for compound questions first
      const compoundResponse = this.handleCompoundQuestion(message);
      if (compoundResponse) {
        return compoundResponse;
      }
      
      const intent = this.classifyIntent(message, conversationState);
      
      console.log(`Chatbot - User: ${userId}, Message: "${message}", Intent: ${intent}`);

      switch (intent) {
        case 'greeting':
          return this.handleGreeting(user);
        
        case 'check_appointment':
          return await this.handleCheckAppointment(userId, message);
        
        case 'reschedule_appointment':
          return await this.handleRescheduleAppointment(userId, message, conversationState);
        
        case 'cancel_appointment':
          return await this.handleCancelAppointment(userId, message, conversationState);
        
        case 'queue_status':
          return await this.handleQueueStatus(userId, message);
        
        case 'hospital_info':
          return await this.handleHospitalInfo(message);
        
        case 'account_help':
          return this.handleAccountHelp(message);
        
        case 'book_appointment':
          return this.handleBookAppointment();
        
        case 'emergency':
          return this.handleEmergency();
        
        case 'escalate':
          return this.handleEscalation();
        
        case 'unknown':
        default:
          return this.handleUnknown(message);
      }
    } catch (error) {
      console.error('Chatbot service error:', error);
      return this.createResponse("I'm sorry, I encountered an error. Please try again or contact our support team.", 'error');
    }
  }

  classifyIntent(message, conversationState) {
    const msg = message.toLowerCase().trim();
    
    // Remove common filler words and normalize
    const normalizedMsg = msg.replace(/\b(please|can you|could you|i want to|i need to|i would like to)\b/g, '').trim();
    
    // Priority-based intent classification (higher priority first)
    
    // 1. Emergency patterns (highest priority)
    if (msg.match(/\b(emergency|urgent|critical|ambulance|life.?threatening|heart attack|stroke|accident)\b/)) {
      return 'emergency';
    }
    
    // 2. Greeting patterns
    if (msg.match(/^(hi|hello|hey|good morning|good afternoon|good evening|greetings?)\b/) || 
        msg.match(/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/)) {
      return 'greeting';
    }
    
    // 3. Cancel patterns - specific appointment cancellation
    if (msg.match(/\b(cancel|cancelled|cancellation|delete|remove|stop|abort|terminate|drop|withdraw)\s+(my\s+)?(appointment|booking|visit)\b/) ||
        msg.match(/\b(i\s+want\s+to\s+)?cancel\b/) ||
        msg.match(/\b(cancel|delete|remove)\s+(appointment|booking)\b/)) {
      return 'cancel_appointment';
    }
    
    // 4. Reschedule patterns - specific appointment rescheduling
    if (msg.match(/\b(reschedule|change|modify|move|postpone|shift|rebook|re-book)\s+(my\s+)?(appointment|booking|visit)\b/) ||
        msg.match(/\b(i\s+want\s+to\s+)?(reschedule|change|modify)\b/) ||
        msg.match(/\b(reschedule|change|modify)\s+(appointment|booking)\b/)) {
      return 'reschedule_appointment';
    }
    
    // 5. Queue status patterns - specific queue/token queries
    if (msg.match(/\b(queue|token|wait|turn|how long|when|status|position|number)\b/) &&
        (msg.match(/\b(my|current|today|now)\b/) || msg.match(/\b(where|what|how)\b/))) {
      return 'queue_status';
    }
    
    // 6. Appointment checking patterns - specific appointment queries
    if ((msg.match(/\b(show|check|view)\s+(my\s+)?(appointment|appointments|booking|bookings|schedule|scheduled)\b/) ||
        msg.match(/\b(what|when|where)\s+(is|are)\s+(my\s+)?(appointment|booking|visit)\b/) ||
        msg.match(/\b(do\s+i\s+have|have\s+i\s+got)\s+(any\s+)?(appointment|booking)\b/) ||
        msg.match(/\b(my\s+)?(appointment|appointments|booking|bookings|schedule|scheduled)\b/)) &&
        !msg.match(/\b(book|new|schedule|make)\b/)) {
      return 'check_appointment';
    }
    
    // 7. Hospital info patterns - specific information queries
    if (msg.match(/\b(department|departments|timing|timings|opd\s+timing|opd\s+timings|hours|location|address|phone|contact|parking|document|documents|opd|hospital|info|information)\b/) ||
        msg.match(/\b(what|when|where|how)\s+(are|is)\s+(the\s+)?(timing|timings|hours|location|address|phone|contact|parking|document|documents|opd|hospital|info|information)\b/) ||
        msg.match(/\b(which\s+)?(department|departments)\s+(do\s+you\s+have|are\s+available)\b/) ||
        msg.match(/\b(what|which)\s+(document|documents)\s+(should|do)\s+(i\s+)?(bring|need|require)\b/)) {
      return 'hospital_info';
    }
    
    // 8. Account help patterns - specific account/profile queries
    if ((msg.match(/\b(profile|account|password|family\s+member|patient\s+id|forgot)\b/) ||
        msg.match(/\b(how\s+to\s+)?(update|change|modify)\s+(profile|account|password|information)\b/) ||
        msg.match(/\b(add|manage)\s+(family\s+member|family\s+members|account)\b/) ||
        msg.match(/\b(patient\s+id|forgot\s+password|reset\s+password)\b/) ||
        msg.match(/\b(update|change)\s+(my\s+)?(profile|account|password)\b/) ||
        msg.match(/\bmanage\s+account\b/)) &&
        !msg.match(/\b(appointment|booking|schedule)\b/)) {
      return 'account_help';
    }
    
    // 9. Booking patterns - specific booking queries
    if ((msg.match(/\b(book|new|appointment|schedule|consultation|make\s+an\s+appointment)\b/) ||
        msg.match(/\b(how\s+to\s+)?(book|schedule|make)\s+(an\s+)?(appointment|booking|visit)\b/) ||
        msg.match(/\b(i\s+want\s+to\s+)?(book|schedule|make)\b/)) &&
        !msg.match(/\b(show|check|view|my|existing)\b/)) {
      return 'book_appointment';
    }
    
    // 10. Escalation patterns - specific help/support queries
    if (msg.match(/\b(speak|talk|human|person|staff|reception|support|help|assistance)\b/) &&
        !msg.match(/\b(emergency|urgent|critical)\b/)) {
      return 'escalate';
    }
    
    // 11. General help patterns
    if (msg.match(/\b(help|assist|support|what\s+can\s+you\s+do|capabilities|features)\b/)) {
      return 'hospital_info'; // Redirect to general hospital info
    }
    
    return 'unknown';
  }

  handleGreeting(user) {
    const responses = [
      `Hi ${user.name}! 👋 I'm MediQ Assistant. How can I help you today?`,
      `Hello ${user.name}! I'm here to help with your medical appointments and hospital queries. What do you need?`,
      `Welcome back ${user.name}! I can help you check appointments, reschedule, get hospital information, and more. What would you like to do?`
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    return this.createResponse(randomResponse, 'greeting');
  }

  async handleCheckAppointment(userId, message) {
    try {
      const appointments = await Token.find({
        patient_id: userId,
        status: { $in: ['booked', 'in_queue'] }
      })
      .populate('doctor_id', 'name doctor_info')
      .populate('family_member_id', 'name relation')
      .sort({ booking_date: 1 });

      if (appointments.length === 0) {
        return this.createResponse(
          "You don't have any upcoming appointments. Would you like to book a new appointment?",
          'no_appointments'
        );
      }

      let response = "Here are your upcoming appointments:\n\n";
      
      appointments.forEach((apt, index) => {
        const date = new Date(apt.booking_date).toLocaleDateString();
        const time = apt.time_slot;
        const doctorName = apt.doctor_id?.name || 'Unknown Doctor';
        const patientName = apt.family_member_id ? apt.family_member_id.name : 'You';
        const relation = apt.family_member_id ? ` (${apt.family_member_id.relation})` : '';
        
        response += `${index + 1}. **${patientName}${relation}**\n`;
        response += `   Doctor: Dr. ${doctorName}\n`;
        response += `   Date: ${date}\n`;
        response += `   Time: ${time}\n`;
        response += `   Token: #${apt.token_number}\n`;
        response += `   Status: ${apt.status.charAt(0).toUpperCase() + apt.status.slice(1)}\n\n`;
      });

      response += "Would you like to reschedule or cancel any of these appointments?";
      
      return this.createResponse(response, 'appointments_list');
    } catch (error) {
      console.error('Error fetching appointments:', error);
      return this.createResponse("I couldn't retrieve your appointments. Please try again or contact support.", 'error');
    }
  }

  async handleRescheduleAppointment(userId, message, conversationState) {
    try {
      // First, show current appointments
      const appointments = await Token.find({
        patient_id: userId,
        status: { $in: ['booked', 'in_queue'] }
      })
      .populate('doctor_id', 'name doctor_info')
      .populate('family_member_id', 'name relation')
      .sort({ booking_date: 1 });

      if (appointments.length === 0) {
        return this.createResponse(
          "You don't have any appointments to reschedule. Would you like to book a new appointment?",
          'no_appointments'
        );
      }

      let response = "I can help you reschedule your appointment! Here are your upcoming appointments:\n\n";
      
      appointments.forEach((apt, index) => {
        const date = new Date(apt.booking_date).toLocaleDateString();
        const doctorName = apt.doctor_id?.name || 'Unknown Doctor';
        const patientName = apt.family_member_id ? apt.family_member_id.name : 'You';
        
        response += `${index + 1}. ${patientName} (${apt.family_member_id?.relation || 'Self'})\n`;
        response += `   Doctor: Dr. ${doctorName}\n`;
        response += `   Date: ${date}\n`;
        response += `   Time: ${apt.time_slot}\n`;
        response += `   Token: #T${apt.token_number}\n\n`;
      });

      response += "To reschedule your appointment, please visit your appointments page where you can:\n";
      response += "• View all your appointments\n";
      response += "• Reschedule to different dates/times\n";
      response += "• See available time slots\n";
      response += "• Cancel if needed\n\n";
      response += "Click here to go to your appointments: [Manage Appointments](/appointments)";
      
      return this.createResponse(response, 'reschedule_redirect');
    } catch (error) {
      console.error('Error handling reschedule:', error);
      return this.createResponse("I couldn't process your reschedule request. Please try again.", 'error');
    }
  }

  async handleCancelAppointment(userId, message, conversationState) {
    try {
      const appointments = await Token.find({
        patient_id: userId,
        status: { $in: ['booked', 'in_queue'] }
      })
      .populate('doctor_id', 'name doctor_info')
      .populate('family_member_id', 'name relation')
      .sort({ booking_date: 1 });

      if (appointments.length === 0) {
        return this.createResponse(
          "You don't have any appointments to cancel. Would you like to book a new appointment?",
          'no_appointments'
        );
      }

      let response = "I can help you cancel your appointment! Here are your upcoming appointments:\n\n";
      
      appointments.forEach((apt, index) => {
        const date = new Date(apt.booking_date).toLocaleDateString();
        const doctorName = apt.doctor_id?.name || 'Unknown Doctor';
        const patientName = apt.family_member_id ? apt.family_member_id.name : 'You';
        
        response += `${index + 1}. ${patientName} (${apt.family_member_id?.relation || 'Self'})\n`;
        response += `   Doctor: Dr. ${doctorName}\n`;
        response += `   Date: ${date}\n`;
        response += `   Time: ${apt.time_slot}\n`;
        response += `   Token: #T${apt.token_number}\n\n`;
      });

      response += "To cancel or reschedule your appointment, please visit your appointments page where you can:\n";
      response += "• View all your appointments\n";
      response += "• Cancel appointments (up to 2 hours before)\n";
      response += "• Reschedule to different dates/times\n";
      response += "• Get refund information\n\n";
      response += "Click here to go to your appointments: [Manage Appointments](/appointments)";
      
      return this.createResponse(response, 'cancel_redirect');
    } catch (error) {
      console.error('Error handling cancel:', error);
      return this.createResponse("I couldn't process your cancellation request. Please try again.", 'error');
    }
  }

  async handleQueueStatus(userId, message) {
    try {
      const appointments = await Token.find({
        patient_id: userId,
        status: { $in: ['booked', 'in_queue'] }
      })
      .populate('doctor_id', 'name doctor_info')
      .sort({ booking_date: 1 });

      if (appointments.length === 0) {
        return this.createResponse(
          "You don't have any appointments in the queue.",
          'no_appointments'
        );
      }

      let response = "Here's your current queue status:\n\n";
      
      for (const apt of appointments) {
        const doctorName = apt.doctor_id?.name || 'Unknown Doctor';
        const date = new Date(apt.booking_date).toLocaleDateString();
        
        // Get queue position (simplified - in real implementation, calculate based on token numbers)
        const queuePosition = await this.getQueuePosition(apt._id);
        
        response += `**Dr. ${doctorName}** - ${date} at ${apt.time_slot}\n`;
        response += `Token: #${apt.token_number}\n`;
        response += `Queue Position: ${queuePosition}\n`;
        response += `Estimated Wait: ${apt.estimated_wait_time || 15} minutes\n\n`;
      }

      response += "You'll be notified when it's your turn. Please wait in the waiting area.";
      
      return this.createResponse(response, 'queue_status');
    } catch (error) {
      console.error('Error getting queue status:', error);
      return this.createResponse("I couldn't get your queue status. Please check with the reception desk.", 'error');
    }
  }

  async getQueuePosition(appointmentId) {
    try {
      const appointment = await Token.findById(appointmentId);
      if (!appointment) return 'Unknown';

      // Count appointments before this one for the same doctor and date
      const nextDay = new Date(appointment.booking_date);
      nextDay.setDate(nextDay.getDate() + 1);
      
      const appointmentsBefore = await Token.countDocuments({
        doctor_id: appointment.doctor_id,
        booking_date: { $gte: appointment.booking_date, $lt: nextDay },
        time_slot: { $lt: appointment.time_slot },
        status: { $in: ['booked', 'in_queue'] }
      });

      return appointmentsBefore + 1;
    } catch (error) {
      console.error('Error calculating queue position:', error);
      return 'Unknown';
    }
  }

  async handleHospitalInfo(message) {
    const msg = message.toLowerCase();
    
    // Specific department queries
    if (msg.includes('department') || msg.includes('specialist') || msg.includes('specialty')) {
      if (msg.includes('cardiology') || msg.includes('heart')) {
        return this.createResponse(
          "**🫀 Cardiology Department**\n\n" +
          "Our Cardiology department provides comprehensive heart care services including:\n" +
          "• Heart disease diagnosis and treatment\n" +
          "• Cardiac surgery\n" +
          "• Angioplasty and stenting\n" +
          "• Pacemaker implantation\n" +
          "• Cardiac rehabilitation\n\n" +
          "**Available Doctors:** Dr. Sharma, Dr. Patel\n" +
          "**Timings:** Monday-Friday, 9 AM - 5 PM\n" +
          "**Location:** 2nd Floor, Block A",
          'department_info'
        );
      }
      
      if (msg.includes('neurology') || msg.includes('brain') || msg.includes('nerve')) {
        return this.createResponse(
          "**🧠 Neurology Department**\n\n" +
          "Our Neurology department specializes in brain and nervous system disorders:\n" +
          "• Stroke treatment\n" +
          "• Epilepsy management\n" +
          "• Headache and migraine treatment\n" +
          "• Parkinson's disease care\n" +
          "• Multiple sclerosis treatment\n\n" +
          "**Available Doctors:** Dr. Kumar, Dr. Singh\n" +
          "**Timings:** Monday-Friday, 9 AM - 5 PM\n" +
          "**Location:** 3rd Floor, Block A",
          'department_info'
        );
      }
      
      return this.createResponse(this.faqData.departments, 'info');
    }
    
    // Specific timing queries
    if (msg.includes('timing') || msg.includes('time') || msg.includes('hours') || msg.includes('opd')) {
      if (msg.includes('emergency') || msg.includes('24') || msg.includes('urgent')) {
        return this.createResponse(
          "**🚨 Emergency Services - 24/7**\n\n" +
          "Our emergency department is open 24 hours a day, 7 days a week for:\n" +
          "• Life-threatening emergencies\n" +
          "• Accident victims\n" +
          "• Critical care\n" +
          "• Ambulance services\n\n" +
          "**Emergency Numbers:**\n" +
          "• +91-8589062432\n" +
          "• +91-9061493022\n" +
          "• 108 (Government Ambulance)\n\n" +
          "**Location:** Ground Floor, Main Building",
          'emergency_info'
        );
      }
      
      return this.createResponse(this.faqData.timings, 'info');
    }
    
    // Emergency-specific queries
    if (msg.includes('emergency') || msg.includes('urgent') || msg.includes('critical')) {
      return this.createResponse(this.faqData.emergency, 'info');
    }
    
    // Location-specific queries
    if (msg.includes('location') || msg.includes('address') || msg.includes('where')) {
      return this.createResponse(this.faqData.location, 'info');
    }
    
    // Parking queries
    if (msg.includes('parking') || msg.includes('car') || msg.includes('vehicle')) {
      return this.createResponse(this.faqData.parking, 'info');
    }
    
    // Document queries
    if (msg.includes('document') || msg.includes('paper') || msg.includes('bring')) {
      return this.createResponse(this.faqData.documents, 'info');
    }
    
    // Payment queries
    if (msg.includes('payment') || msg.includes('cost') || msg.includes('fee') || msg.includes('price')) {
      return this.createResponse(this.faqData.payment, 'info');
    }
    
    // Cancellation queries
    if (msg.includes('cancellation') || msg.includes('cancel')) {
      return this.createResponse(this.faqData.cancellation, 'info');
    }
    
    // Reschedule queries
    if (msg.includes('reschedule')) {
      return this.createResponse(this.faqData.reschedule, 'info');
    }
    
    // Get available departments from database
    let departmentsInfo = "";
    try {
      const departments = await Department.find({}).select('name description');
      if (departments && departments.length > 0) {
        departmentsInfo = "**Available Departments:**\n";
        departments.forEach((dept, index) => {
          departmentsInfo += `${index + 1}. **${dept.name}**\n`;
          if (dept.description) {
            departmentsInfo += `   ${dept.description}\n`;
          }
        });
        departmentsInfo += "\n";
      } else {
        departmentsInfo = `📋 **Departments:** ${this.faqData.departments}\n\n`;
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
      departmentsInfo = `📋 **Departments:** ${this.faqData.departments}\n\n`;
    }
    
    // Comprehensive hospital information
    return this.createResponse(
      "🏥 **Welcome to MediQ - Your Digital Healthcare Partner!** 🏥\n\n" +
      
      "**About MediQ:**\n" +
      "MediQ is a next-generation healthcare platform that revolutionizes the way you manage your medical appointments. " +
      "We provide a comprehensive digital token management system that eliminates long wait times, offers transparent booking, " +
      "and optimizes both patient and doctor experiences.\n\n" +
      
      "**🌟 Key Features:**\n" +
      "• **Smart Appointment Booking** - Book appointments 24/7\n" +
      "• **Real-time Queue Management** - Track your position in the queue\n" +
      "• **Digital Token System** - No more paper tokens\n" +
      "• **Family Member Management** - Book for your entire family\n" +
      "• **Mobile & Web Access** - Access from anywhere, anytime\n" +
      "• **Transparent Pricing** - Know costs upfront\n\n" +
      
      departmentsInfo +
      
      `🕒 **OPD Timings:**\n` +
      `• **Morning Session:** 9:00 AM - 1:00 PM\n` +
      `• **Afternoon Session:** 2:00 PM - 6:00 PM\n` +
      `• **Emergency Services:** 24/7\n\n` +
      
      `📍 **Location:**\n` +
      `123 Medical Street, Health City\n` +
      `PIN: 123456\n` +
      `Nearest Metro: Health City Metro Station\n` +
      `Bus Routes: 15, 23, 45, 67\n\n` +
      
      `📞 **Contact Information:**\n` +
      `• **General Enquiries:** +91-9876543210\n` +
      `• **Emergency:** +91-8589062432 or +91-9061493022\n` +
      `• **Email:** info@mediq.com\n` +
      `• **WhatsApp:** +91-9876543213\n\n` +
      
      `💳 **Payment Options:**\n` +
      `• Cash, Card, UPI, Digital Wallets\n` +
      `• Online payment through portal\n` +
      `• Insurance accepted\n\n` +
      
      `🚗 **Parking & Facilities:**\n` +
      `• Free parking for patients\n` +
      `• Wheelchair accessible\n` +
      `• Pharmacy on-site\n` +
      `• Cafeteria available\n\n` +
      
      "**📱 Quick Booking Options:**\n" +
      "• **Online:** [Book Appointment](/booking) - Available 24/7\n" +
      "• **Mobile App:** Download from App Store/Play Store\n" +
      "• **Phone:** Call +91-9876543210\n" +
      "• **Walk-in:** Visit our reception desk\n\n" +
      
      "**🔗 Useful Links:**\n" +
      "• [View My Appointments](/appointments) - Manage your bookings\n" +
      "• [Book New Appointment](/booking) - Schedule a visit\n" +
      "• [Emergency Contact](/emergency) - Get immediate help\n" +
      "• [Hospital Information](/info) - Learn more about us\n\n" +
      
      "Is there anything specific you'd like to know more about? I'm here to help! 😊",
      'hospital_info'
    );
  }

  handleAccountHelp(message) {
    const msg = message.toLowerCase();
    
    // Handle "manage account" specifically
    if (msg.includes('manage account') || msg.includes('manage my account')) {
      return this.createResponse(
        "I can help you manage your account! Here's what you can do:\n\n" +
        "**Account Management Features:**\n" +
        "• Update your personal information\n" +
        "• Manage family members\n" +
        "• Change your password\n" +
        "• View your Patient ID\n" +
        "• Update emergency contacts\n" +
        "• Manage notification preferences\n\n" +
        "Click here to access your account management: [Manage Account](/manage-account)",
        'account_redirect'
      );
    }
    
    if (msg.includes('profile') || msg.includes('update')) {
      return this.createResponse(
        "To update your profile:\n" +
        "1. Go to your dashboard\n" +
        "2. Click on 'Profile' or 'My Account'\n" +
        "3. Update the information you need\n" +
        "4. Click 'Save Changes'\n\n" +
        "You can update your name, phone, address, emergency contact, and medical information.\n\n" +
        "Click here to manage your account: [Manage Account](/manage-account)",
        'account_redirect'
      );
    }
    
    if (msg.includes('family') || msg.includes('member')) {
      return this.createResponse(
        "To manage family members:\n" +
        "1. Go to your dashboard\n" +
        "2. Click on 'Family Members'\n" +
        "3. Click 'Add Family Member' to add someone\n" +
        "4. Fill in their details and medical history\n" +
        "5. You can book appointments for family members\n\n" +
        "You can add parents, spouse, children, and other family members.\n\n" +
        "Click here to manage your account: [Manage Account](/manage-account)",
        'account_redirect'
      );
    }
    
    if (msg.includes('password') || msg.includes('forgot')) {
      return this.createResponse(
        "To change your password:\n" +
        "1. Go to 'Account Settings'\n" +
        "2. Click 'Change Password'\n" +
        "3. Enter your current password\n" +
        "4. Enter your new password\n" +
        "5. Confirm the new password\n\n" +
        "If you forgot your password, click 'Forgot Password' on the login page.\n\n" +
        "Click here to manage your account: [Manage Account](/manage-account)",
        'account_redirect'
      );
    }
    
    if (msg.includes('patient id')) {
      return this.createResponse(
        "Your Patient ID is displayed on your dashboard and appointment confirmations. " +
        "It's also sent to your registered email when you create an account. " +
        "If you can't find it, please contact our support team.",
        'help'
      );
    }
    
    return this.createResponse(
      "I can help you with:\n" +
      "• Updating your profile information\n" +
      "• Managing family members\n" +
      "• Changing your password\n" +
      "• Finding your Patient ID\n" +
      "• Account settings\n\n" +
      "Click here to manage your account: [Manage Account](/manage-account)\n\n" +
      "What specific account help do you need?",
      'account_redirect'
    );
  }

  handleBookAppointment() {
    return this.createResponse(
      "To book a new appointment:\n\n" +
      "1. **Online Booking:**\n" +
      "   • Go to your dashboard\n" +
      "   • Click 'Book Appointment'\n" +
      "   • Select department and doctor\n" +
      "   • Choose date and time\n" +
      "   • Complete booking\n\n" +
      "2. **Phone Booking:**\n" +
      "   • Call our reception: +91-9876543210\n" +
      "   • Available 9 AM - 6 PM\n\n" +
      "3. **WhatsApp Booking:**\n" +
      "   • Send 'BOOK' to our WhatsApp number\n" +
      "   • Follow the prompts\n\n" +
      "Would you like me to help you with anything else?",
      'booking_help'
    );
  }

  handleEmergency() {
    return this.createResponse(
      "🚨 **EMERGENCY CONTACTS** 🚨\n\n" +
      "**Immediate Emergency:**\n" +
      "• Call: +91-9876543210\n" +
      "• Visit: Emergency Department (24/7)\n" +
      "• Location: Ground Floor, Main Building\n\n" +
      "**Ambulance Service:**\n" +
      "• Call: 108 (Government)\n" +
      "• Call: +91-9876543211 (Private)\n\n" +
      "**For non-emergency medical advice:**\n" +
      "• Call: +91-9876543212\n" +
      "• Available: 24/7\n\n" +
      "If this is a life-threatening emergency, please call emergency services immediately!",
      'emergency'
    );
  }

  handleEscalation() {
    return this.createResponse(
      "I understand you'd like to speak with our staff. Here are your options:\n\n" +
      "**During OPD Hours (9 AM - 6 PM):**\n" +
      "• Call Reception: +91-9876543210\n" +
      "• Visit Reception Desk (Ground Floor)\n" +
      "• Live Chat: Available on our website\n\n" +
      "**Outside OPD Hours:**\n" +
      "• Emergency: +91-8589062432 or +91-9061493022\n" +
      "• Email: support@medihospital.com\n" +
      "• WhatsApp: +91-9876543213\n\n" +
      "**For Technical Issues:**\n" +
      "• Email: tech@medihospital.com\n" +
      "• Call: +91-9876543214\n\n" +
      "Is there anything else I can help you with right now?",
      'escalation'
    );
  }

  handleUnknown(message) {
    const msg = message.toLowerCase();
    
    // Try to provide more specific help based on keywords in the message
    if (msg.includes('appointment') || msg.includes('booking') || msg.includes('schedule')) {
      return this.createResponse(
        "I can help you with appointments! You can:\n\n" +
        "• **Check your appointments** - Ask 'Show me my appointments'\n" +
        "• **Reschedule** - Ask 'I want to reschedule my appointment'\n" +
        "• **Cancel** - Ask 'I want to cancel my appointment'\n" +
        "• **Book new** - Ask 'I want to book an appointment'\n\n" +
        "What would you like to do with your appointments?",
        'help'
      );
    }
    
    if (msg.includes('time') || msg.includes('timing') || msg.includes('hours')) {
      return this.createResponse(
        "I can help you with timing information! You can ask about:\n\n" +
        "• **OPD Timings** - 'What are the OPD timings?'\n" +
        "• **Department Hours** - 'What are the department timings?'\n" +
        "• **Emergency Hours** - 'Is emergency available 24/7?'\n\n" +
        "What specific timing information do you need?",
        'help'
      );
    }
    
    if (msg.includes('department') || msg.includes('doctor') || msg.includes('specialist')) {
      return this.createResponse(
        "I can help you with department information! You can ask about:\n\n" +
        "• **Available Departments** - 'What departments do you have?'\n" +
        "• **Department Details** - 'Tell me about cardiology department'\n" +
        "• **Doctor Information** - 'Who are the doctors in neurology?'\n\n" +
        "What department information do you need?",
        'help'
      );
    }
    
    if (msg.includes('location') || msg.includes('address') || msg.includes('where')) {
      return this.createResponse(
        "I can help you with location information! You can ask about:\n\n" +
        "• **Hospital Address** - 'Where is the hospital located?'\n" +
        "• **Parking** - 'Is parking available?'\n" +
        "• **Directions** - 'How do I reach the hospital?'\n\n" +
        "What location information do you need?",
        'help'
      );
    }
    
    if (msg.includes('payment') || msg.includes('cost') || msg.includes('price') || msg.includes('fee')) {
      return this.createResponse(
        "I can help you with payment information! You can ask about:\n\n" +
        "• **Payment Methods** - 'What payment methods do you accept?'\n" +
        "• **Consultation Fees** - 'What are the consultation fees?'\n" +
        "• **Insurance** - 'Do you accept insurance?'\n\n" +
        "What payment information do you need?",
        'help'
      );
    }
    
    // Default response with more specific suggestions
    return this.createResponse(
      "I'm here to help! I can assist you with:\n\n" +
      "**📅 Appointments:**\n" +
      "• Check your appointments\n" +
      "• Reschedule or cancel appointments\n" +
      "• Book new appointments\n" +
      "• Check queue status\n\n" +
      "**🏥 Hospital Information:**\n" +
      "• Department details\n" +
      "• OPD timings\n" +
      "• Location and parking\n" +
      "• Contact information\n\n" +
      "**👤 Account Help:**\n" +
      "• Update profile\n" +
      "• Manage family members\n" +
      "• Password reset\n\n" +
      "**🚨 Emergency:**\n" +
      "• Emergency contacts\n" +
      "• Ambulance service\n\n" +
      "What would you like help with? You can ask in your own words!",
      'help'
    );
  }

  createResponse(message, type = 'info', actions = []) {
    return {
      message,
      type,
      actions,
      timestamp: new Date().toISOString()
    };
  }

  getConversationState(userId) {
    return this.conversationStates.get(userId) || {};
  }

  setConversationState(userId, state) {
    this.conversationStates.set(userId, state);
  }

  clearConversationState(userId) {
    this.conversationStates.delete(userId);
  }

  // Handle compound questions that contain multiple intents
  handleCompoundQuestion(message) {
    const msg = message.toLowerCase();
    
    // Questions that ask about account and appointments
    if (msg.includes('account') && msg.includes('appointment')) {
      return this.createResponse(
        "I can help you with both your account and appointments! Let me break this down:\n\n" +
        "**For Account Help:**\n" +
        "• Update profile information\n" +
        "• Change password\n" +
        "• Manage family members\n" +
        "• Find your Patient ID\n\n" +
        "**For Appointments:**\n" +
        "• Check your appointments\n" +
        "• Reschedule or cancel\n" +
        "• Book new appointments\n\n" +
        "Could you ask about one topic at a time so I can give you the most helpful answer? " +
        "For example, ask 'How do I update my profile?' or 'Show me my appointments'.",
        'compound_question'
      );
    }
    
    // Questions that ask multiple things at once
    if (msg.includes('and') && (msg.includes('appointment') || msg.includes('timing') || msg.includes('department'))) {
      return this.createResponse(
        "I can help you with multiple things! Let me break this down:\n\n" +
        "It looks like you're asking about several topics. I can help you with:\n" +
        "• **Appointments** - Check, reschedule, or cancel\n" +
        "• **Timings** - OPD hours and department schedules\n" +
        "• **Departments** - Available specialties and services\n\n" +
        "Could you ask about one thing at a time so I can give you the most helpful answer? " +
        "For example, you could ask 'What are the OPD timings?' or 'Show me my appointments'.",
        'compound_question'
      );
    }
    
    // Questions with multiple question marks or "and" statements
    if ((msg.split('?').length > 2) || (msg.includes('and') && msg.split('and').length > 2)) {
      return this.createResponse(
        "I can help you with that! It looks like you have multiple questions. " +
        "To give you the best answers, could you ask one question at a time? " +
        "I'm here to help with each of your concerns!",
        'compound_question'
      );
    }
    
    return null; // Not a compound question
  }

  // Process follow-up messages in conversation flows
  async processFollowUp(userId, message) {
    const state = this.getConversationState(userId);
    
    if (state.action === 'reschedule' && state.step === 'select_appointment') {
      return await this.handleRescheduleSelection(userId, message, state);
    }
    
    if (state.action === 'cancel' && state.step === 'select_appointment') {
      return await this.handleCancelSelection(userId, message, state);
    }
    
    // If no active conversation, process as new message
    return await this.processMessage(userId, message);
  }

  async handleRescheduleSelection(userId, message, state) {
    const selection = parseInt(message.trim());
    
    if (isNaN(selection) || selection < 1 || selection > state.appointments.length) {
      return this.createResponse(
        "Please enter a valid number (1, 2, etc.) to select the appointment you want to reschedule.",
        'error'
      );
    }
    
    const selectedAppointment = state.appointments[selection - 1];
    
    // Update conversation state
    this.setConversationState(userId, {
      ...state,
      step: 'confirm_reschedule',
      selectedAppointment
    });
    
    return this.createResponse(
      `You want to reschedule:\n\n` +
      `Doctor: Dr. ${selectedAppointment.doctorName}\n` +
      `Date: ${new Date(selectedAppointment.date).toLocaleDateString()}\n` +
      `Time: ${selectedAppointment.time}\n` +
      `Token: #${selectedAppointment.tokenNumber}\n\n` +
      `To reschedule, please:\n` +
      `1. Go to your dashboard\n` +
      `2. Click on "My Appointments"\n` +
      `3. Find this appointment and click "Reschedule"\n` +
      `4. Select a new date and time\n\n` +
      `Or call our reception at +91-9876543210 for assistance.`,
      'reschedule_instructions'
    );
  }

  async handleCancelSelection(userId, message, state) {
    const selection = parseInt(message.trim());
    
    if (isNaN(selection) || selection < 1 || selection > state.appointments.length) {
      return this.createResponse(
        "Please enter a valid number (1, 2, etc.) to select the appointment you want to cancel.",
        'error'
      );
    }
    
    const selectedAppointment = state.appointments[selection - 1];
    
    // Update conversation state
    this.setConversationState(userId, {
      ...state,
      step: 'confirm_cancel',
      selectedAppointment
    });
    
    return this.createResponse(
      `You want to cancel:\n\n` +
      `Doctor: Dr. ${selectedAppointment.doctorName}\n` +
      `Date: ${new Date(selectedAppointment.date).toLocaleDateString()}\n` +
      `Time: ${selectedAppointment.time}\n` +
      `Token: #${selectedAppointment.tokenNumber}\n\n` +
      `To cancel this appointment:\n` +
      `1. Go to your dashboard\n` +
      `2. Click on "My Appointments"\n` +
      `3. Find this appointment and click "Cancel"\n` +
      `4. Provide a reason for cancellation\n\n` +
      `Or call our reception at +91-9876543210 for assistance.\n\n` +
      `**Note:** Cancellations made more than 2 hours before the appointment time are eligible for refund.`,
      'cancel_instructions'
    );
  }
}

module.exports = new ChatbotService();

