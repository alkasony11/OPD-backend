const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, OTP, PasswordResetToken } = require('../models/User');
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

// Helper function to send password reset email with link
const sendPasswordResetEmail = async (email, resetToken) => {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;

  console.log('Sending password reset email to:', email);
  console.log('Reset URL:', resetUrl);
  console.log('Reset token:', resetToken);

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Password Reset Request',
    text: `You requested a password reset. Click the following link to reset your password: ${resetUrl}. This link will expire in 1 hour.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #333; margin-bottom: 10px;">Password Reset Request</h1>
          <p style="color: #666; font-size: 16px;">We received a request to reset your password</p>
        </div>

        <div style="background-color: #f8f9fa; padding: 30px; border-radius: 10px; text-align: center; margin: 30px 0;">
          <p style="color: #333; font-size: 16px; margin-bottom: 25px;">
            Click the button below to reset your password:
          </p>
          <a href="${resetUrl}"
             style="display: inline-block; background-color:rgb(0, 0, 0); color: white; padding: 15px 30px;
                    text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">
            Reset Password
          </a>
        </div>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
          <p style="color: #666; font-size: 14px; margin-bottom: 10px;">
            <strong>Important:</strong> This link will expire in 1 hour for security reasons.
          </p>
          <p style="color: #666; font-size: 14px; margin-bottom: 10px;">
            If you didn't request this password reset, please ignore this email.
          </p>
          <p style="color: #666; font-size: 14px;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${resetUrl}" style="color:rgb(0, 0, 0); word-break: break-all;">${resetUrl}</a>
          </p>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
};

// Send OTP for registration
router.post('/send-otp', async (req, res) => {
  try {
    console.log('Send OTP request received for email:', req.body.email);
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Check if user already exists
    console.log('Checking if user exists for email:', email);
    const existingUser = await User.findOne({ email });
    console.log('Existing user found:', existingUser ? 'Yes' : 'No');

    if (existingUser) {
      console.log('User already exists, returning error');
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
    
    // Check if user is admin
    const isAdmin = user.email === process.env.ADMIN_EMAIL;

    // Create token with role information
    const token = jwt.sign({
      userId: user._id,
      role: isAdmin ? 'admin' : 'user'
    }, 'your_jwt_secret', { expiresIn: '1d' });

    console.log('Login successful');
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: isAdmin ? 'admin' : 'user'
      },
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
    console.log('Clerk sync request received:', req.body);
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

    let isNewUser = false;

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
      console.log('Creating new user for Clerk ID:', clerkId);
      isNewUser = true;
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

      console.log('About to save new user:', user);
      await user.save();
      console.log('New Clerk user created:', user.email);
    }

    // Check if user is admin
    const isAdmin = user.email === process.env.ADMIN_EMAIL;
    console.log('Admin check - User email:', user.email);
    console.log('Admin check - Admin email from env:', process.env.ADMIN_EMAIL);
    console.log('Admin check - Is admin:', isAdmin);

    // Create JWT token for your backend with role information
    const token = jwt.sign({
      userId: user._id,
      role: isAdmin ? 'admin' : 'user'
    }, 'your_jwt_secret', { expiresIn: '1d' });

    // Check if user profile is complete (has additional details)
    const isProfileComplete = !!(user.phone && user.dob && user.gender);

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        dob: user.dob,
        gender: user.gender,
        profileImage: user.profileImage,
        clerkId: user.clerkId,
        authProvider: user.authProvider,
        role: isAdmin ? 'admin' : 'user'
      },
      isNewUser,
      isProfileComplete,
      message: 'User synchronized successfully'
    });

  } catch (error) {
    console.error('Clerk sync error:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ message: 'Server error during synchronization', error: error.message });
  }
});

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, 'your_jwt_secret');
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, 'your_jwt_secret');
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user fields
    const { name, phone, dob, gender, address, emergencyContact } = req.body;

    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (dob) user.dob = new Date(dob);
    if (gender) user.gender = gender;
    if (address) user.address = address;
    if (emergencyContact) user.emergencyContact = emergencyContact;

    await user.save();

    // Return updated user without password
    const updatedUser = await User.findById(user._id).select('-password');
    res.json(updatedUser);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Forgot Password - Send Reset Link
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

    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Delete any existing password reset tokens for this email
    await PasswordResetToken.deleteMany({ email });

    // Save new reset token
    const tokenDoc = new PasswordResetToken({
      email,
      token: resetToken
    });
    await tokenDoc.save();

    // Send password reset email with link
    await sendPasswordResetEmail(email, resetToken);

    res.json({ message: 'Password reset link sent to your email' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Failed to send password reset link. Please try again.' });
  }
});

// Reset Password with Token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: 'Reset token and new password are required' });
    }

    // Verify token
    const tokenDoc = await PasswordResetToken.findOne({
      token,
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!tokenDoc) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Find user
    const user = await User.findOne({ email: tokenDoc.email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Update user password
    user.password = hashedPassword;
    await user.save();

    // Mark token as used
    tokenDoc.used = true;
    await tokenDoc.save();

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Failed to reset password. Please try again.' });
  }
});

// Verify Reset Token (for frontend validation)
router.get('/verify-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    console.log('Verifying reset token:', token);

    const tokenDoc = await PasswordResetToken.findOne({
      token,
      used: false,
      expiresAt: { $gt: new Date() }
    });

    console.log('Token document found:', !!tokenDoc);
    if (tokenDoc) {
      console.log('Token email:', tokenDoc.email);
      console.log('Token expires at:', tokenDoc.expiresAt);
      console.log('Token used:', tokenDoc.used);
    }

    if (!tokenDoc) {
      console.log('Token validation failed - invalid or expired');
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    console.log('Token validation successful');
    res.json({ message: 'Token is valid', email: tokenDoc.email });
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({ message: 'Failed to verify token' });
  }
});

module.exports = router;

