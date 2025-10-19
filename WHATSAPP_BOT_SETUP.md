# WhatsApp Bot Setup Guide for MediQ Hospital

## 🎯 Overview
Your MediQ Hospital booking system now has a fully functional WhatsApp bot that can handle unlimited messages for FREE using WhatsApp Cloud API.

## 🚀 Features
- ✅ **Unlimited Messages** (1,000 free per month, then $0.005 per message)
- ✅ **Appointment Booking** via WhatsApp
- ✅ **Appointment Management** (check, reschedule, cancel)
- ✅ **Queue Status** tracking
- ✅ **Hospital Information** queries
- ✅ **Emergency Contacts** 
- ✅ **Multi-language Support** (ready for expansion)
- ✅ **Family Member Booking**
- ✅ **Real-time Notifications**

## 📋 Setup Instructions

### Step 1: Create Meta Business Account
1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create a new app
3. Add WhatsApp product to your app
4. Get your Phone Number ID and Access Token

### Step 2: Configure Environment Variables
Add these to your `.env` file:

```env
# WhatsApp Cloud API Configuration
WHATSAPP_ACCESS_TOKEN=your_access_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
WHATSAPP_WEBHOOK_URL=https://yourdomain.com/api/whatsapp/webhook
WHATSAPP_VERIFY_TOKEN=your_secure_verify_token_here

# Optional: For testing without API
WHATSAPP_TEST_MODE=true
```

### Step 3: Set Up Webhook
1. In Meta Developer Console, set webhook URL to: `https://yourdomain.com/api/whatsapp/webhook`
2. Set verify token to match your `WHATSAPP_VERIFY_TOKEN`
3. Subscribe to `messages` events

### Step 4: Test Your Bot
Send a test message to your WhatsApp number:
```bash
curl -X POST http://localhost:5000/api/whatsapp/send-test \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "1234567890", "message": "Hello from MediQ!"}'
```

## 💬 How Patients Use the Bot

### Basic Commands
- **"Hi"** or **"Hello"** - Get welcome message
- **"Book appointment"** - Start booking process
- **"My appointments"** - View upcoming appointments
- **"Reschedule"** - Reschedule existing appointment
- **"Cancel"** - Cancel appointment
- **"Status"** - Check queue position
- **"Help"** - Get help information
- **"Emergency"** - Get emergency contacts

### Example Conversation
```
Patient: Hi
Bot: Hello John! 👋 I'm MediQ Assistant. How can I help you today?

Patient: Book appointment
Bot: To book a new appointment:
1. Online Booking: Go to your dashboard
2. Phone Booking: Call +91-9876543210
3. WhatsApp Booking: Send 'BOOK' to our WhatsApp number

Patient: My appointments
Bot: Here are your upcoming appointments:
1. Dr. Sharma - Cardiology
   Date: 2024-01-15
   Time: 10:00 AM
   Token: #T001
   Status: Booked
```

## 🔧 Advanced Configuration

### Customizing Messages
Edit `backend/src/services/whatsappBotService.js` to customize:
- Welcome messages
- Appointment confirmations
- Reminder templates
- Emergency information

### Adding New Commands
Edit `backend/src/services/chatbotService.js` to add:
- New intent classifications
- Custom response handlers
- Integration with other services

### Multi-language Support
The bot is ready for multi-language support. Add language detection in `chatbotService.js`:

```javascript
// Example: Detect language and respond accordingly
const detectLanguage = (message) => {
  // Add your language detection logic
  return 'en'; // or 'hi', 'ta', etc.
};
```

## 📊 Monitoring & Analytics

### View Bot Activity
Check logs for WhatsApp bot activity:
```bash
# View real-time logs
tail -f logs/whatsapp-bot.log

# View specific message types
grep "WhatsApp message" logs/app.log
```

### Track Usage
Monitor your WhatsApp API usage in Meta Developer Console to stay within free limits.

## 🆘 Troubleshooting

### Common Issues

1. **Messages not sending**
   - Check `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`
   - Verify webhook is properly configured
   - Check Meta Developer Console for errors

2. **Webhook verification failing**
   - Ensure `WHATSAPP_VERIFY_TOKEN` matches in both places
   - Check webhook URL is accessible
   - Verify SSL certificate

3. **Rate limiting**
   - WhatsApp has rate limits (1000 messages/day for new numbers)
   - Implement queuing for high-volume usage

### Debug Mode
Enable debug mode by setting `WHATSAPP_TEST_MODE=true` in your `.env` file. This will log messages instead of sending them.

## 🚀 Going Live

### Pre-launch Checklist
- [ ] Test all bot commands
- [ ] Verify webhook is working
- [ ] Test with real phone numbers
- [ ] Set up monitoring
- [ ] Train staff on bot capabilities
- [ ] Create user documentation

### Launch Strategy
1. **Soft Launch**: Test with staff and select patients
2. **Announcement**: Inform patients about WhatsApp booking
3. **Full Launch**: Enable for all patients
4. **Monitor**: Track usage and optimize

## 📈 Scaling Up

### For High Volume
- Implement message queuing
- Use WhatsApp Business API (paid tier)
- Add more phone numbers
- Implement load balancing

### Additional Features
- Voice message support
- Image/document sharing
- Payment integration
- Multi-language support
- AI-powered responses

## 🎉 Success!

Your WhatsApp bot is now ready to handle unlimited patient interactions for FREE! 

**Next Steps:**
1. Set up Meta Business account
2. Configure environment variables
3. Test with real phone numbers
4. Launch to patients

**Need Help?** Check the logs or contact the development team.

---
*Last updated: January 2024*
