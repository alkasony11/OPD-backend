require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
// Seed file removed - use admin panel to create doctors instead

const app = express();
const server = http.createServer(app);
// Parse CORS origins from environment variable
const corsOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:5173'];
const corsMethods = process.env.CORS_METHODS ? process.env.CORS_METHODS.split(',') : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const corsCredentials = process.env.CORS_CREDENTIALS === 'true';

const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: corsMethods,
    credentials: corsCredentials
  }
});
const PORT = process.env.PORT || 5001;

// Middleware
const corsAllowedHeaders = process.env.CORS_ALLOWED_HEADERS ? process.env.CORS_ALLOWED_HEADERS.split(',') : ['Content-Type', 'Authorization', 'X-Requested-With'];

const corsOptions = {
  origin: corsOrigins,
  credentials: corsCredentials,
  methods: corsMethods,
  allowedHeaders: corsAllowedHeaders
};
app.use(cors(corsOptions));
// Generic preflight handler to ensure PATCH appears in allowed methods
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', corsMethods.join(','));
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
const mongoUri = process.env.MONGODB_URI ;
console.log(`Connecting to MongoDB at ${mongoUri.includes('mongodb+srv') ? 'Atlas cluster (from env)' : mongoUri}`);
mongoose.connect(mongoUri).then(() => {
    console.log("Connected to MongoDB");
}).catch(err => console.error("Database connection error:", err));

// Initialize Socket.IO and realtime sync service
const RealtimeSyncService = require('./src/services/realtimeSyncService');
const realtimeSyncService = new RealtimeSyncService(io);
global.realtimeSyncService = realtimeSyncService;

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  // Handle room joining
  socket.on('join-admin', () => {
    socket.join('admin');
    console.log('👤 Admin joined:', socket.id);
  });

  socket.on('join-doctor', () => {
    socket.join('doctor');
    console.log('👤 Doctor joined:', socket.id);
  });

  socket.on('join-patient', () => {
    socket.join('patient');
    console.log('👤 Patient joined:', socket.id);
  });

  socket.on('join-doctor-room', (doctorId) => {
    socket.join(`doctor-${doctorId}`);
    console.log(`👤 Doctor ${doctorId} joined their room:`, socket.id);
  });

  socket.on('join-patient-room', (patientId) => {
    socket.join(`patient-${patientId}`);
    console.log(`👤 Patient ${patientId} joined their room:`, socket.id);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

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

console.log("Loading notification routes...");
const notificationRoutes = require("./src/routes/notifications.js");
console.log("Notification routes loaded, registering...");
app.use("/api/notifications", notificationRoutes);
console.log("Notification routes registered successfully");

console.log("Loading diagnosis routes...");
const diagnosisRoutes = require("./src/routes/diagnosis.js");
console.log("Diagnosis routes loaded, registering...");
app.use("/api/diagnosis", diagnosisRoutes);
console.log("Diagnosis routes registered successfully");

console.log("Loading debug routes...");
const debugRoutes = require("./src/routes/debug.js");
console.log("Debug routes loaded, registering...");
app.use("/api/debug", debugRoutes);
console.log("Debug routes registered successfully");


// Start server
server.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Socket.IO server ready for real-time connections`);

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
    
    // Start cron service for automatic appointment cancellations
    const cronService = require('./src/services/cronService');
    cronService.start();
    console.log('⏰ Automatic appointment cancellation service started');
});


