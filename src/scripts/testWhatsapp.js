const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const sendWhatsAppMessage = require('../services/whatsappService');

const toNumber = process.argv[2];

if (!toNumber) {
    console.log('❌ Error: No phone number provided.');
    console.log('Usage: node src/scripts/testWhatsapp.js <phone_number>');
    console.log('Example: node src/scripts/testWhatsapp.js +1234567890');
    process.exit(1);
}

console.log('🚀 Starting Twilio WhatsApp Test...');
console.log('-----------------------------------');
console.log(`📍 To: ${toNumber}`);
console.log(`📍 From Env: ${process.env.TWILIO_WHATSAPP_NUMBER}`);
console.log(`📍 SID: ${process.env.TWILIO_SID ? 'Loaded ✅' : 'Missing ❌'}`);
console.log(`📍 Auth: ${process.env.TWILIO_AUTH ? 'Loaded ✅' : 'Missing ❌'}`);
console.log('-----------------------------------');

if (!process.env.TWILIO_SID || !process.env.TWILIO_AUTH) {
    console.error('❌ Missing Twilio credentials in .env file');
    process.exit(1);
}

const testMessage = `
🔍 *MediaQ WhatsApp Test*

This is a test message to verify your Twilio integration.
If you see this, the connection is working! ✅

Time: ${new Date().toLocaleTimeString()}
`;

sendWhatsAppMessage(toNumber, testMessage)
    .then(result => {
        if (result.success) {
            console.log('✅ Message sent successfully!');
            console.log('Message SID:', result.sid);
        } else {
            console.log('❌ Failed to send message.');
            console.error(result.error);
        }
    })
    .catch(err => {
        console.error('❌ Unexpected error:', err);
    });
