# Notification Services Setup Guide

This guide explains how to configure email, SMS, and WhatsApp notifications for the MediQ Hospital system.

## Overview

The system now sends professional notifications via three channels after booking completion:
- **Email**: Professional HTML emails with appointment details
- **SMS**: Text messages via Twilio
- **WhatsApp**: Rich messages via WhatsApp Business API

## Environment Variables

Add these variables to your `.env` file:

### Email Configuration (Gmail SMTP)
```env
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-app-password
```

**Setup Steps:**
1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password: Google Account → Security → App passwords
3. Use the app password (not your regular password) in EMAIL_PASS

### SMS Configuration (Twilio)
```env
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
```

**Setup Steps:**
1. Sign up for Twilio at https://www.twilio.com
2. Get your Account SID and Auth Token from the Twilio Console
3. Purchase a phone number from Twilio
4. Add the credentials to your .env file

### WhatsApp Business API Configuration
```env
WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token
WHATSAPP_PHONE_NUMBER_ID=your_whatsapp_phone_number_id
WHATSAPP_WEBHOOK_URL=https://your-domain.com/api/whatsapp/webhook
WHATSAPP_VERIFY_TOKEN=your_whatsapp_verify_token
```

**Setup Steps:**
1. Create a Meta for Developers account
2. Create a WhatsApp Business App
3. Get your access token and phone number ID
4. Set up webhook URL (for receiving messages)
5. Add credentials to your .env file

## Testing the Services

Run the notification test script:

```bash
node test-notification-services.js
```

This will:
- Check if all services are properly configured
- Test email connectivity
- Test SMS service configuration
- Display setup instructions for missing services

## Notification Features

### Booking Confirmation
When a patient books an appointment, they receive:
- **Email**: Professional HTML email with appointment details, instructions, and contact info
- **SMS**: Concise text message with key appointment details
- **WhatsApp**: Rich message with appointment details and quick action buttons

### Appointment Reminders
24 hours before the appointment:
- **Email**: Reminder email with appointment details
- **SMS**: Short reminder text
- **WhatsApp**: Friendly reminder message

### Cancellation Confirmations
When an appointment is cancelled:
- **Email**: Cancellation confirmation with refund details (if applicable)
- **SMS**: Cancellation confirmation text
- **WhatsApp**: Cancellation message with refund info

## Professional Email Templates

The email templates include:
- Hospital branding and professional design
- Complete appointment details
- Important instructions for patients
- Contact information and emergency numbers
- Action buttons for managing appointments
- Mobile-responsive design

## SMS Templates

SMS messages are concise and include:
- Hospital name and branding
- Key appointment details
- Contact information
- Professional tone

## WhatsApp Messages

WhatsApp messages include:
- Rich formatting with emojis
- Complete appointment details
- Quick action suggestions
- Professional hospital branding

## Development Mode

If services are not configured, the system will:
- Log messages to console instead of sending
- Continue to function normally
- Display helpful setup instructions

## Production Deployment

For production deployment:
1. Set up all three notification services
2. Use production-grade credentials
3. Test thoroughly before going live
4. Monitor notification delivery rates
5. Set up proper error handling and logging

## Troubleshooting

### Email Issues
- Verify Gmail app password is correct
- Check if 2FA is enabled
- Ensure EMAIL_USER is correct

### SMS Issues
- Verify Twilio credentials
- Check if phone number is verified
- Ensure sufficient Twilio balance

### WhatsApp Issues
- Verify Meta Business API credentials
- Check webhook configuration
- Ensure phone number is approved

## Support

For technical support or questions about notification setup, contact the development team.
