const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const chatbotService = require('../services/chatbotService');

// Middleware to check if user is a patient
const patientMiddleware = async (req, res, next) => {
  try {
    const { User } = require('../models/User');
    const user = await User.findById(req.user.userId);
    if (!user || user.role !== 'patient') {
      return res.status(403).json({ message: 'Access denied. Patient role required.' });
    }
    req.patient = user;
    next();
  } catch (error) {
    console.error('Patient middleware error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Send message to chatbot
router.post('/message', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { message, context = {} } = req.body;
    
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ message: 'Message is required' });
    }

    const response = await chatbotService.processMessage(req.patient._id, message.trim(), context);
    
    res.json({
      success: true,
      response,
      conversationId: req.patient._id // Using patient ID as conversation ID
    });
  } catch (error) {
    console.error('Chatbot message error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to process message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Process follow-up message in conversation flow
router.post('/follow-up', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ message: 'Message is required' });
    }

    const response = await chatbotService.processFollowUp(req.patient._id, message.trim());
    
    res.json({
      success: true,
      response,
      conversationId: req.patient._id
    });
  } catch (error) {
    console.error('Chatbot follow-up error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to process follow-up message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get conversation history (optional - for future implementation)
router.get('/history', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    // In a real implementation, you would store conversation history in database
    // For now, we'll return a simple response
    res.json({
      success: true,
      history: [],
      message: 'Conversation history feature coming soon'
    });
  } catch (error) {
    console.error('Get conversation history error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get conversation history'
    });
  }
});

// Clear conversation state
router.delete('/clear-conversation', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    chatbotService.clearConversationState(req.patient._id);
    
    res.json({
      success: true,
      message: 'Conversation cleared successfully'
    });
  } catch (error) {
    console.error('Clear conversation error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to clear conversation'
    });
  }
});

// Get chatbot status and capabilities
router.get('/status', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    res.json({
      success: true,
      status: 'active',
      capabilities: [
        'Check appointments',
        'Reschedule appointments',
        'Cancel appointments',
        'Get queue status',
        'Hospital information',
        'Account help',
        'Emergency contacts',
        'Booking assistance'
      ],
      supportedIntents: [
        'greeting',
        'check_appointment',
        'reschedule_appointment',
        'cancel_appointment',
        'queue_status',
        'hospital_info',
        'account_help',
        'book_appointment',
        'emergency',
        'escalate'
      ]
    });
  } catch (error) {
    console.error('Get chatbot status error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get chatbot status'
    });
  }
});

// Get quick actions/suggestions
router.get('/quick-actions', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const quickActions = [
      {
        id: 'check_appointments',
        label: 'Check My Appointments',
        message: 'Show me my appointments',
        icon: 'calendar'
      },
      {
        id: 'reschedule',
        label: 'Reschedule Appointment',
        message: 'I want to reschedule my appointment',
        icon: 'edit'
      },
      {
        id: 'cancel',
        label: 'Cancel Appointment',
        message: 'I want to cancel my appointment',
        icon: 'x'
      },
      {
        id: 'queue_status',
        label: 'Check Queue Status',
        message: 'What\'s my token number and wait time?',
        icon: 'clock'
      },
      {
        id: 'hospital_info',
        label: 'Hospital Information',
        message: 'What are the OPD timings?',
        icon: 'info'
      },
      {
        id: 'emergency',
        label: 'Emergency Contact',
        message: 'I need emergency help',
        icon: 'phone'
      }
    ];

    res.json({
      success: true,
      quickActions
    });
  } catch (error) {
    console.error('Get quick actions error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get quick actions'
    });
  }
});

// Get FAQ categories
router.get('/faq-categories', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const categories = [
      {
        id: 'appointments',
        name: 'Appointments',
        icon: 'calendar',
        questions: [
          'How do I book an appointment?',
          'How do I reschedule my appointment?',
          'How do I cancel my appointment?',
          'What documents should I bring?'
        ]
      },
      {
        id: 'hospital',
        name: 'Hospital Information',
        icon: 'building',
        questions: [
          'What are the OPD timings?',
          'What departments do you have?',
          'Where is the hospital located?',
          'Is parking available?'
        ]
      },
      {
        id: 'account',
        name: 'Account & Profile',
        icon: 'user',
        questions: [
          'How do I update my profile?',
          'How do I add family members?',
          'I forgot my Patient ID',
          'How do I change my password?'
        ]
      },
      {
        id: 'emergency',
        name: 'Emergency',
        icon: 'phone',
        questions: [
          'What is the emergency number?',
          'Is emergency service available 24/7?',
          'How do I contact ambulance?'
        ]
      }
    ];

    res.json({
      success: true,
      categories
    });
  } catch (error) {
    console.error('Get FAQ categories error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get FAQ categories'
    });
  }
});

// Get specific FAQ answer
router.get('/faq/:category', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const { question } = req.query;
    
    if (!question) {
      return res.status(400).json({ message: 'Question parameter is required' });
    }

    // Process the question through chatbot service
    const response = await chatbotService.processMessage(req.patient._id, question);
    
    res.json({
      success: true,
      category,
      question,
      response
    });
  } catch (error) {
    console.error('Get FAQ answer error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get FAQ answer'
    });
  }
});

// Test endpoint for development
router.get('/test', authMiddleware, patientMiddleware, async (req, res) => {
  try {
    const testMessage = "Hi, I want to check my appointments";
    const response = await chatbotService.processMessage(req.patient._id, testMessage);
    
    res.json({
      success: true,
      testMessage,
      response,
      message: 'Chatbot test successful'
    });
  } catch (error) {
    console.error('Chatbot test error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Chatbot test failed',
      error: error.message
    });
  }
});

module.exports = router;

