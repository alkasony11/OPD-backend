# WhatsApp Integration for Appointment Management

## Overview

This document describes the comprehensive WhatsApp integration implemented for the MediQ Hospital appointment management system. The integration provides professional, chatbot-like messaging for all appointment-related actions including booking, cancellation, rescheduling, and status updates.

## Features

### 🤖 Professional Messaging
- **Consistent Branding**: All messages include MediQ Hospital branding and professional formatting
- **Rich Formatting**: Uses WhatsApp's markdown formatting for better readability
- **Emoji Integration**: Strategic use of emojis for visual appeal and clarity
- **Quick Actions**: Interactive chatbot-like responses for easy user interaction

### 📱 Message Types

#### 1. Booking Confirmation
- **Trigger**: When a patient successfully books an appointment
- **Content**: 
  - Appointment details (date, time, doctor, department, token)
  - Important reminders (arrival time, required documents)
  - Quick action commands for management
- **Integration Points**: Patient booking, Receptionist booking, Admin booking

#### 2. Cancellation Confirmation
- **Trigger**: When an appointment is cancelled (by patient, admin, or automatically)
- **Content**:
  - Cancelled appointment details
  - Refund information (if applicable)
  - Next steps and available actions
- **Integration Points**: Patient cancellation, Admin cancellation, Automatic cancellation

#### 3. Rescheduling Confirmation
- **Trigger**: When an appointment is rescheduled
- **Content**:
  - Previous appointment details
  - New appointment details
  - Important reminders
  - Management options
- **Integration Points**: Patient rescheduling, Receptionist rescheduling, Admin rescheduling

#### 4. Status Updates
- **Trigger**: When appointment status changes (completed, missed, etc.)
- **Content**:
  - Status-specific messaging
  - Additional information
  - Next steps
- **Integration Points**: Doctor completion, System updates

#### 5. Welcome Messages
- **Trigger**: For new users or first-time interactions
- **Content**:
  - Hospital welcome
  - Available services
  - Quick action commands
  - 24/7 assistance information

#### 6. Emergency Information
- **Trigger**: When users request emergency contacts
- **Content**:
  - Emergency phone numbers
  - Ambulance services
  - Hospital location
  - 24/7 availability

#### 7. Hospital Information
- **Trigger**: When users request general information
- **Content**:
  - OPD timings
  - Available departments
  - Contact information
  - Location details

## Technical Implementation

### Service Architecture

```
WhatsAppBotService
├── sendBookingConfirmation()
├── sendCancellationConfirmation()
├── sendReschedulingConfirmation()
├── sendAppointmentStatusUpdate()
├── sendWelcomeMessage()
├── sendEmergencyInfo()
├── sendHospitalInfo()
├── sendAppointmentReminder()
├── sendQueueUpdate()
└── sendLeaveCancellation()
```

### Integration Points

#### 1. Patient Routes (`/api/patient/`)
- **Booking**: `POST /book-appointment`
- **Cancellation**: `POST /appointments/:id/cancel`
- **Rescheduling**: `POST /appointments/:id/reschedule`

#### 2. Receptionist Routes (`/api/receptionist/`)
- **Booking**: `POST /appointments`
- **Rescheduling**: `PATCH /appointments/:id/reschedule`

#### 3. Admin Routes (`/api/admin/`)
- **Cancellation**: `PUT /patients/:patientId/appointments/:appointmentId/cancel`
- **Rescheduling**: `PUT /patients/:patientId/appointments/:appointmentId/reschedule`

#### 4. Automatic Services
- **Cancellation Service**: Automatic no-show cancellations
- **Notification Service**: Comprehensive notification system

### Message Templates

All messages follow a consistent professional template:

```
🏥 *MediQ Hospital - [Action Title]*

Dear [Patient Name],

[Action-specific content with details]

📱 *Important Reminders:*
• [Relevant reminders]

🤖 *Quick Actions (Reply with):*
• "My Appointments" - [Description]
• "Book Appointment" - [Description]
• "Help" - [Description]

Thank you for choosing MediQ Hospital! 🏥
```

## Configuration

### Environment Variables

```env
# WhatsApp Cloud API Configuration
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_VERIFY_TOKEN=your_verify_token
WHATSAPP_WEBHOOK_URL=https://your-domain.com/api/whatsapp/webhook
```

### API Endpoints

#### Webhook Endpoints
- `GET /api/whatsapp/webhook` - Webhook verification
- `POST /api/whatsapp/webhook` - Message processing

#### Management Endpoints
- `POST /api/whatsapp/send-test` - Send test message
- `POST /api/whatsapp/send-welcome` - Send welcome message
- `POST /api/whatsapp/send-confirmation/:appointmentId` - Send booking confirmation
- `POST /api/whatsapp/send-cancellation/:appointmentId` - Send cancellation confirmation
- `POST /api/whatsapp/send-rescheduling/:appointmentId` - Send rescheduling confirmation
- `POST /api/whatsapp/send-status-update/:appointmentId` - Send status update
- `GET /api/whatsapp/status` - Get bot status

## Usage Examples

### 1. Testing the Integration

```javascript
const whatsappBotService = require('./src/services/whatsappBotService');

// Send a test message
await whatsappBotService.sendMessage('whatsapp:+919876543210', 'Hello from MediQ Hospital!');

// Send booking confirmation
await whatsappBotService.sendBookingConfirmation('appointment_id');

// Send cancellation with refund info
const refundInfo = {
  eligible: true,
  amount: 500,
  method: 'upi',
  status: 'processed'
};
await whatsappBotService.sendCancellationConfirmation('appointment_id', refundInfo);
```

### 2. Running the Test Script

```bash
# Navigate to backend directory
cd backend

# Run the test script
node test-whatsapp-integration.js
```

## Error Handling

The integration includes comprehensive error handling:

- **API Failures**: Graceful fallback to logging mode
- **Invalid Data**: Validation and error messages
- **Network Issues**: Retry logic and timeout handling
- **Rate Limiting**: Proper handling of WhatsApp API limits

## Monitoring and Logging

All WhatsApp interactions are logged with:
- Message content and recipients
- Success/failure status
- Error details and stack traces
- Performance metrics

## Security Considerations

- **Phone Number Validation**: Proper formatting and validation
- **Message Sanitization**: Prevention of injection attacks
- **Rate Limiting**: Protection against spam
- **Webhook Security**: Token verification for webhook endpoints

## Future Enhancements

1. **Rich Media Support**: Images, documents, and location sharing
2. **Interactive Buttons**: Quick reply buttons for common actions
3. **Multi-language Support**: Messages in different languages
4. **Analytics Dashboard**: Message delivery and engagement metrics
5. **Template Management**: Dynamic message template system

## Troubleshooting

### Common Issues

1. **Messages Not Sending**
   - Check WhatsApp API credentials
   - Verify phone number format
   - Check API rate limits

2. **Webhook Not Working**
   - Verify webhook URL is accessible
   - Check verify token configuration
   - Ensure HTTPS is enabled

3. **Message Formatting Issues**
   - Check markdown syntax
   - Verify emoji support
   - Test with different devices

### Debug Mode

Enable debug logging by setting:
```env
DEBUG=whatsapp:*
```

## Support

For technical support or questions about the WhatsApp integration:
- Check the logs for error details
- Verify configuration settings
- Test with the provided test script
- Review the API documentation

---

*This integration provides a professional, user-friendly WhatsApp experience that enhances patient communication and engagement with the MediQ Hospital system.*
