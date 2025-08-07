require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
// Seed file removed - use admin panel to create doctors instead

const app = express();
const PORT = 5001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', 'http://localhost:5177', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175', 'http://127.0.0.1:5176', 'http://127.0.0.1:5177'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Test route
app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || "mongodb+srv://alkasony2026:alka2003@cluster0.fl4gy.mongodb.net/Mediq?retryWrites=true&w=majority&appName=Cluster0").then(() => {
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


// Start server
app.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`);

    // Sample data seeding removed - use admin panel to create doctors
    console.log('✅ Server ready! Use admin panel to create doctors and manage users.');
});


