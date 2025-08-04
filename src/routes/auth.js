const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, OTP } = require('../models/User');
const { transporter } = require('../config/email');
const crypto = require('crypto');

const router = express.Router();

// Helper function to generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Helper function to send OTP email
const sendOTPEmail = async (email, otp, type = 'registration') => {
  const subject = type === 'registration' ? 'Email Verification OTP' : 'Password Reset OTP';
  const message = type === 'registration'
    ? `Your OTP for email verification is: ${otp}. This OTP will expire in 10 minutes.`
    : `Your OTP for password reset is: ${otp}. This OTP will expire in 10 minutes.`;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: subject,
    text: message,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">${subject}</h2>
        <p>Your OTP is:</p>
        <div style="background-color: #f0f0f0; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
          ${otp}
        </div>
        <p style="color: #666;">This OTP will expire in 10 minutes.</p>
        <p style="color: #666;">If you didn't request this, please ignore this email.</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
};

// Send OTP for registration
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Generate OTP
    const otp = generateOTP();

    // Delete any existing OTPs for this email
    await OTP.deleteMany({ email, type: 'registration' });

    // Save new OTP
    const otpDoc = new OTP({
      email,
      otp,
      type: 'registration'
    });
    await otpDoc.save();

    // Send OTP email
    await sendOTPEmail(email, otp, 'registration');

    res.json({ message: 'OTP sent successfully to your email' });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
  }
});

// Register with OTP verification
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, dob, gender, otp } = req.body;

    // Validate required fields
    if (!name || !email || !password || !otp) {
      return res.status(400).json({ message: 'Name, email, password, and OTP are required' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Verify OTP
    const otpDoc = await OTP.findOne({
      email,
      otp,
      type: 'registration',
      expiresAt: { $gt: new Date() }
    });

    if (!otpDoc) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = new User({
      name,
      email,
      password: hashedPassword,
      phone: phone || '',
      dob: dob ? new Date(dob) : undefined,
      gender: gender || '',
      isVerified: true // User is verified since they provided valid OTP
    });

    await user.save();

    // Delete the used OTP
    await OTP.deleteOne({ _id: otpDoc._id });

    // Create token
    const token = jwt.sign({ userId: user._id }, 'your_jwt_secret', { expiresIn: '1d' });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        dob: user.dob,
        gender: user.gender
      },
      message: 'User created successfully'
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('Login attempt for:', email);
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found');
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('Password mismatch');
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Create token
    const token = jwt.sign({ userId: user._id }, 'your_jwt_secret', { expiresIn: '1d' });
    
    console.log('Login successful');
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email },
      message: 'Login successful'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Clerk user synchronization
router.post('/clerk-sync', async (req, res) => {
  try {
    const { clerkId, email, name, phone, profileImage } = req.body;
    
    if (!clerkId || !email) {
      return res.status(400).json({ message: 'Clerk ID and email are required' });
    }
    
    // Check if user already exists by Clerk ID or email
    let user = await User.findOne({ 
      $or: [
        { clerkId: clerkId },
        { email: email }
      ]
    });
    
    if (user) {
      // Update existing user with Clerk data
      user.clerkId = clerkId;
      user.name = name || user.name;
      user.phone = phone || user.phone;
      user.profileImage = profileImage || user.profileImage;
      user.isVerified = true; // Clerk users are pre-verified
      user.authProvider = 'clerk';
      
      await user.save();
    } else {
      // Create new user from Clerk data
      user = new User({
        clerkId,
        email,
        name: name || 'User',
        phone: phone || '',
        profileImage: profileImage || '',
        isVerified: true,
        authProvider: 'clerk',
        // No password needed for Clerk users
        password: null
      });
      
      await user.save();
    }
    
    // Create JWT token for your backend
    const token = jwt.sign({ userId: user._id }, 'your_jwt_secret', { expiresIn: '1d' });
    
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        profileImage: user.profileImage,
        clerkId: user.clerkId
      },
      message: 'User synchronized successfully'
    });
    
  } catch (error) {
    console.error('Clerk sync error:', error);
    res.status(500).json({ message: 'Server error during synchronization' });
  }
});

// Forgot Password - Send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'No user found with this email address' });
    }

    // Generate OTP
    const otp = generateOTP();

    // Delete any existing password reset OTPs for this email
    await OTP.deleteMany({ email, type: 'password_reset' });

    // Save new OTP
    const otpDoc = new OTP({
      email,
      otp,
      type: 'password_reset'
    });
    await otpDoc.save();

    // Send OTP email
    await sendOTPEmail(email, otp, 'password_reset');

    res.json({ message: 'Password reset OTP sent to your email' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Failed to send password reset OTP. Please try again.' });
  }
});

// Reset Password with OTP
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, password } = req.body;

    if (!email || !otp || !password) {
      return res.status(400).json({ message: 'Email, OTP, and new password are required' });
    }

    // Verify OTP
    const otpDoc = await OTP.findOne({
      email,
      otp,
      type: 'password_reset',
      expiresAt: { $gt: new Date() }
    });

    if (!otpDoc) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Update user password
    user.password = hashedPassword;
    await user.save();

    // Delete the used OTP
    await OTP.deleteOne({ _id: otpDoc._id });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Failed to reset password. Please try again.' });
  }
});

module.exports = router;

