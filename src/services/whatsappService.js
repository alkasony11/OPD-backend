const twilio = require("twilio");
require("dotenv").config();

// Initialize Twilio client
// Note: Twilio client requires Account SID and Auth Token
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

/**
 * Send a WhatsApp message using Twilio
 * @param {string} to - Recipient's phone number (e.g., '+919876543210')
 * @param {string} message - Message body
 */
const sendWhatsAppMessage = async (to, message) => {
  try {
    console.log(`Attempting to send WhatsApp message to ${to}`);
    
    // Ensure the 'to' number is in whatsapp format
    const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    
    // Ensure the 'from' number is in whatsapp format (from env)
    const fromFormatted = process.env.TWILIO_WHATSAPP_NUMBER.startsWith('whatsapp:') 
      ? process.env.TWILIO_WHATSAPP_NUMBER 
      : `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;

    console.log(`Using sender: ${fromFormatted}`);

    const result = await client.messages.create({
      body: message,
      from: fromFormatted,
      to: toFormatted
    });
    
    console.log("WhatsApp message sent successfully via Twilio:", result.sid);
    return { success: true, sid: result.sid };
  } catch (err) {
    console.error("Twilio WhatsApp Error:", err.message);
    console.error("Error details:", err);
    return { success: false, error: err.message };
  }
};

module.exports = sendWhatsAppMessage;
