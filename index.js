require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
// Seed file removed - use admin panel to create doctors instead

const app = express();
const PORT = 5001;

// Middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', 'http://localhost:5177', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175', 'http://127.0.0.1:5176', 'http://127.0.0.1:5177'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};
app.use(cors(corsOptions));
// Generic preflight handler to ensure PATCH appears in allowed methods
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Test route
app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/opd';
console.log(`Connecting to MongoDB at ${mongoUri.includes('mongodb+srv') ? 'Atlas cluster (from env)' : mongoUri}`);
mongoose.connect(mongoUri).then(() => {
    console.log("Connected to MongoDB");
}).catch(err => console.error("Database connection error:", err));

// Import routes
console.log("Loading auth routes...");
const authRoutes = require("./src/routes/auth.js");
console.log("Auth routes loaded, registering...");
app.use("/api/auth", authRoutes);
console.log("Auth routes registered successfully");

console.log("Loading admin routes...");
const adminRoutes = require("./src/routes/admin.js");
console.log("Admin routes loaded, registering...");
app.use("/api/admin", adminRoutes);
console.log("Admin routes registered successfully");

console.log("Loading doctor routes...");
const doctorRoutes = require("./src/routes/doctor.js");
console.log("Doctor routes loaded, registering...");
app.use("/api/doctor", doctorRoutes);
console.log("Doctor routes registered successfully");

console.log("Loading patient routes...");
const patientRoutes = require("./src/routes/patient.js");
console.log("Patient routes loaded, registering...");
app.use("/api/patient", patientRoutes);
console.log("Patient routes registered successfully");

console.log("Loading receptionist routes...");
const receptionistRoutes = require("./src/routes/receptionist.js");
console.log("Receptionist routes loaded, registering...");
app.use("/api/receptionist", receptionistRoutes);
console.log("Receptionist routes registered successfully");

console.log("Loading chatbot routes...");
const chatbotRoutes = require("./src/routes/chatbot.js");
console.log("Chatbot routes loaded, registering...");
app.use("/api/chatbot", chatbotRoutes);
console.log("Chatbot routes registered successfully");

console.log("Loading WhatsApp routes...");
const whatsappRoutes = require("./src/routes/whatsapp.js");
console.log("WhatsApp routes loaded, registering...");
app.use("/api/whatsapp", whatsappRoutes);
console.log("WhatsApp routes registered successfully");


// Start server
app.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`);

    // Test email configuration
    const { testEmailConfig } = require('./src/config/email');
    console.log('🔧 Testing email configuration...');
    const emailWorking = await testEmailConfig();

    if (emailWorking) {
        console.log('✅ Email service is ready!');
    } else {
        console.log('⚠️  Email service not configured properly. Doctor credentials will not be sent via email.');
    }

    console.log('✅ Server ready! Use admin panel to create doctors and manage users.');
});


