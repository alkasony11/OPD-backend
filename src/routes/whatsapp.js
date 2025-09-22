const express = require('express');
const router = express.Router();
const whatsappBotService = require('../services/whatsappBotService');

// WhatsApp webhook verification
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verificationResult = whatsappBotService.verifyWebhook(mode, token, challenge);
  
  if (verificationResult) {
    console.log('WhatsApp webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('WhatsApp webhook verification failed');
    res.status(403).json({ error: 'Verification failed' });
  }
});

// WhatsApp webhook for receiving messages
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    // Check if this is a WhatsApp message
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (value?.messages) {
        for (const message of value.messages) {
          const from = message.from;
          const text = message.text;
          const type = message.type;

          console.log('Received WhatsApp message:', { from, text, type });

          // Process the message
          await whatsappBotService.processMessage({
            from: `whatsapp:${from}`,
            text: { body: text?.body || '' },
            type
          });
        }
      }

      // Handle status updates (delivered, read, etc.)
      if (value?.statuses) {
        for (const status of value.statuses) {
          console.log('WhatsApp status update:', status);
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Send test message (for development)
router.post('/send-test', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber || !message) {
      return res.status(400).json({ error: 'Phone number and message are required' });
    }

    const result = await whatsappBotService.sendMessage(`whatsapp:${phoneNumber}`, message);
    
    res.json({
      success: true,
      message: 'Test message sent successfully',
      result
    });
  } catch (error) {
    console.error('Send test message error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send test message'
    });
  }
});

// Send appointment reminder
router.post('/send-reminder/:appointmentId', async (req, res) => {
  try {
    const { appointmentId } = req.params;
    
    const result = await whatsappBotService.sendAppointmentReminder(appointmentId);
    
    res.json({
      success: true,
      message: 'Appointment reminder sent successfully',
      result
    });
  } catch (error) {
    console.error('Send appointment reminder error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send appointment reminder'
    });
  }
});

// Send booking confirmation
router.post('/send-confirmation/:appointmentId', async (req, res) => {
  try {
    const { appointmentId } = req.params;
    
    const result = await whatsappBotService.sendBookingConfirmation(appointmentId);
    
    res.json({
      success: true,
      message: 'Booking confirmation sent successfully',
      result
    });
  } catch (error) {
    console.error('Send booking confirmation error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send booking confirmation'
    });
  }
});

// Send cancellation confirmation
router.post('/send-cancellation/:appointmentId', async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { refundInfo } = req.body;
    
    const result = await whatsappBotService.sendCancellationConfirmation(appointmentId, refundInfo);
    
    res.json({
      success: true,
      message: 'Cancellation confirmation sent successfully',
      result
    });
  } catch (error) {
    console.error('Send cancellation confirmation error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send cancellation confirmation'
    });
  }
});

// Send queue update
router.post('/send-queue-update/:appointmentId', async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { queuePosition, estimatedWaitTime } = req.body;
    
    if (!queuePosition || !estimatedWaitTime) {
      return res.status(400).json({ error: 'Queue position and estimated wait time are required' });
    }
    
    const result = await whatsappBotService.sendQueueUpdate(appointmentId, queuePosition, estimatedWaitTime);
    
    res.json({
      success: true,
      message: 'Queue update sent successfully',
      result
    });
  } catch (error) {
    console.error('Send queue update error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send queue update'
    });
  }
});

// Send emergency info
router.post('/send-emergency-info', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    
    const result = await whatsappBotService.sendEmergencyInfo(phoneNumber);
    
    res.json({
      success: true,
      message: 'Emergency information sent successfully',
      result
    });
  } catch (error) {
    console.error('Send emergency info error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send emergency information'
    });
  }
});

// Send hospital info
router.post('/send-hospital-info', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    
    const result = await whatsappBotService.sendHospitalInfo(phoneNumber);
    
    res.json({
      success: true,
      message: 'Hospital information sent successfully',
      result
    });
  } catch (error) {
    console.error('Send hospital info error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send hospital information'
    });
  }
});

// Get WhatsApp bot status
router.get('/status', (req, res) => {
  res.json({
    success: true,
    status: 'active',
    webhookUrl: whatsappBotService.webhookUrl,
    capabilities: [
      'Process incoming messages',
      'Send appointment reminders',
      'Send booking confirmations',
      'Send cancellation confirmations',
      'Send queue updates',
      'Send emergency information',
      'Send hospital information'
    ]
  });
});

module.exports = router;

