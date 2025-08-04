const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const PORT = 5001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175'],
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
mongoose.connect("mongodb+srv://alkasony2026:alka2003@cluster0.fl4gy.mongodb.net/Mediq?retryWrites=true&w=majority&appName=Cluster0", {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("Connected to MongoDB");
}).catch(err => console.error("Database connection error:", err));

// Import routes
console.log("Loading auth routes...");
const authRoutes = require("./routes/auth.js");
console.log("Auth routes loaded, registering...");
app.use("/api/auth", authRoutes);
console.log("Auth routes registered successfully");

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
}); 


