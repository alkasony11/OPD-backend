const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User.js");
const { authMiddleware } = require("../middleware/authMiddleware.js");
const { transporter } = require("../config/email.js");
const crypto = require('crypto');

const router = express.Router();

// In-memory store for OTPs (use database in production)
const otpStore = {};

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP to email
router.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const otp = generateOTP();
    const expires = Date.now() + 5 * 60 * 1000; // 5 minutes

    otpStore[email] = { otp, expires };

    // Send email if configured
    if (process.env.EMAIL_USER && process.env.EMAIL_USER !== 'your-gmail@gmail.com') {
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'MediQ - Email Verification Code',
        text: `Your verification code is: ${otp}\n\nThis code will expire in 5 minutes.\n\nIf you didn't request this registration, please ignore this email.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
            <div style="background-color: white; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <!-- Header -->
              <div style="text-align: center; margin-bottom: 30px;">
                <div style="display: inline-block; background-color: #000; color: white; padding: 15px 25px; border-radius: 8px; font-size: 24px; font-weight: bold;">
                  MediQ
                </div>
              </div>
              
              <!-- Title -->
              <h1 style="color: #333; text-align: center; margin-bottom: 20px; font-size: 24px;">
                Email Verification
              </h1>
              
              <!-- Content -->
              <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
                Thank you for registering with MediQ! To complete your registration, please use the verification code below.
              </p>
              
              <!-- OTP Code -->
              <div style="text-align: center; margin: 30px 0;">
                <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; border: 2px dashed #ddd;">
                  <p style="color: #666; margin-bottom: 15px; font-size: 14px;">Your verification code:</p>
                  <div style="font-size: 32px; font-weight: bold; color: #000; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                    ${otp}
                  </div>
                </div>
              </div>
              
              <!-- Instructions -->
              <div style="background-color: #e8f4fd; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #007bff;">
                <h3 style="color: #333; margin-bottom: 10px; font-size: 16px;">📋 Instructions</h3>
                <ol style="color: #666; margin: 0; padding-left: 20px; line-height: 1.6;">
                  <li>Return to the MediQ registration page</li>
                  <li>Enter the verification code above</li>
                  <li>Complete your registration</li>
                </ol>
              </div>
              
              <!-- Security Notice -->
              <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ffc107;">
                <h3 style="color: #333; margin-bottom: 10px; font-size: 16px;">⚠️ Important</h3>
                <ul style="color: #666; margin: 0; padding-left: 20px; line-height: 1.6;">
                  <li>This code will expire in <strong>5 minutes</strong></li>
                  <li>Do not share this code with anyone</li>
                  <li>If you didn't request this, please ignore this email</li>
                </ul>
              </div>
              
              <!-- Footer -->
              <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                <p style="color: #999; font-size: 12px; margin-bottom: 10px;">
                  This is an automated message from MediQ. Please do not reply to this email.
                </p>
                <p style="color: #999; font-size: 12px;">
                  © 2024 MediQ. All rights reserved.
                </p>
              </div>
            </div>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log(`✅ OTP sent successfully to ${email}`);
    }
    
    res.json({ message: "OTP sent to email successfully" });
  } catch (err) {
    console.error('Email sending error:', err.message);
    res.status(500).json({ 
      message: "Failed to send OTP"
    });
  }
});

// Register with OTP verification
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone, dob, gender, otp } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Verify OTP
    const otpRecord = otpStore[email];
    if (!otpRecord || otpRecord.otp !== otp || Date.now() > otpRecord.expires) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new user
    const user = new User({
      name,
      email,
      password: hashedPassword,
      phone,
      dob,
      gender,
    });
    
    await user.save();
    
    // Remove OTP after successful registration
    delete otpStore[email];
    
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ userId: user._id }, "your_jwt_secret", { expiresIn: "1d" });

    // Exclude password from user object
    const { password: _, ...userData } = user.toObject();

    res.json({
      token,
      user: userData,
      message: "Login successful"
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: 'No user with that email' });

  const token = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = token;
  user.resetPasswordExpires = Date.now() + 30 * 60 * 1000; // 30 minutes
  await user.save();

      // Send email
    const resetLink = `http://localhost:5173/reset-password/${token}`;
    await transporter.sendMail({
      to: user.email,
      from: process.env.EMAIL_USER,
      subject: 'MediQ - Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: white; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="display: inline-block; background-color: #000; color: white; padding: 15px 25px; border-radius: 8px; font-size: 24px; font-weight: bold;">
                MediQ
              </div>
            </div>
            
            <!-- Title -->
            <h1 style="color: #333; text-align: center; margin-bottom: 20px; font-size: 24px;">
              Password Reset Request
            </h1>
            
            <!-- Content -->
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
              Hello ${user.name || 'there'},
            </p>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
              We received a request to reset your password for your MediQ account. If you didn't make this request, you can safely ignore this email.
            </p>
            
            <!-- Button -->
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" style="background-color: #000; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Reset Password
              </a>
            </div>
            
            <!-- Alternative Link -->
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px; font-size: 14px;">
              If the button doesn't work, copy and paste this link into your browser:
            </p>
            <p style="color: #007bff; word-break: break-all; font-size: 14px; margin-bottom: 25px;">
              ${resetLink}
            </p>
            
            <!-- Security Notice -->
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
              <h3 style="color: #333; margin-bottom: 10px; font-size: 16px;">🔒 Security Notice</h3>
              <ul style="color: #666; margin: 0; padding-left: 20px; line-height: 1.6;">
                <li>This link will expire in <strong>30 minutes</strong></li>
                <li>This link can only be used <strong>once</strong></li>
                <li>If you didn't request this, please ignore this email</li>
              </ul>
            </div>
            
            <!-- Footer -->
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 12px; margin-bottom: 10px;">
                This is an automated message from MediQ. Please do not reply to this email.
              </p>
              <p style="color: #999; font-size: 12px;">
                © 2024 MediQ. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      `
    });

  res.json({ message: 'Password reset link sent to your email' });
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() }
  });
  if (!user) return res.status(400).json({ message: 'Invalid or expired token' });

  user.password = await bcrypt.hash(password, 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.json({ message: 'Password reset successful' });
});

// Get user profile (protected route)
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Update user profile (protected route)
router.put("/profile", authMiddleware, async (req, res) => {
  try {
    const { name, phone, dob, gender, address, emergencyContact } = req.body;
    
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update fields
    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (dob) user.dob = dob;
    if (gender) user.gender = gender;
    if (address) user.address = address;
    if (emergencyContact) user.emergencyContact = emergencyContact;

    await user.save();
    
    const userResponse = user.toObject();
    delete userResponse.password;
    
    res.json({ message: "Profile updated successfully", user: userResponse });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router; 