const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, OTP, PasswordResetToken } = require('../models/User');
const { transporter } = require('../config/email');
const CloudinaryService = require('../services/cloudinaryService');
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

// Availability check for email/phone during registration
router.get('/availability', async (req, res) => {
  try {
    const { email } = req.query;
    let { phone } = req.query;

    if (!email && !phone) {
      return res.status(400).json({ message: 'Provide email or phone to check availability' });
    }

    const result = {};

    if (email) {
      const existingByEmail = await User.findOne({ email });
      result.email = { available: !existingByEmail };
    }

    if (phone) {
      // Normalize Indian numbers to 10-digit for consistent storage comparison
      let digits = String(phone).replace(/\D/g, '');
      if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
      if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
      if (digits.length !== 10) {
        return res.status(400).json({ message: 'Invalid phone format' });
      }
      const existingByPhone = await User.findOne({ phone: digits });
      result.phone = { available: !existingByPhone };
    }

    return res.json(result);
  } catch (error) {
    console.error('Availability check error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

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
    const { name, email, password, phone, dob, gender, age, otp } = req.body;

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
      age: age || undefined,
      dob: dob ? new Date(dob) : undefined,
      gender: gender || '',
      role: 'patient', // Force patient role for public registration
      isVerified: true,
      patient_info: {
        family_members: [],
        booking_history: []
      }
    });

    await user.save();

    // Delete the used OTP
    await OTP.deleteOne({ _id: otpDoc._id });

    // Create token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '1d' });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        patientId: user.patientId,
        phone: user.phone,
        age: user.age,
        dob: user.dob,
        gender: user.gender,
        role: user.role
      },
      message: 'User created successfully'
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Check user authentication method - REMOVED
// Users can now use either login method without restrictions

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('Login attempt for:', email);
    }
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('User not found');
      }
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Block inactive users
    if (user.status === 'inactive' || user.isActive === false) {
      return res.status(403).json({ message: 'Your account has been deactivated by the administrator. Please contact support.' });
    }

    // Allow both Google and local authentication
    // If user has a password, check it
    if (user.password) {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('Password mismatch');
        }
        return res.status(400).json({ message: 'Invalid credentials' });
      }
    } else {
      // User doesn't have a password (Google user) - allow them to set one
      // For now, we'll allow them to login and they can set a password later
      console.log('User has no password set, allowing login');
    }
    
    // Determine redirect URL based on role
    let redirectTo = '/';
    switch (user.role) {
      case 'patient':
        redirectTo = '/';
        break;
      case 'doctor':
        redirectTo = '/doctor/dashboard';
        break;
      case 'receptionist':
        redirectTo = '/receptionist/dashboard';
        break;
      case 'admin':
        redirectTo = '/admin/dashboard';
        break;
      default:
        redirectTo = '/';
    }

    // Create token with role information
    // Set expiration based on remember me flag
    const tokenExpiration = rememberMe ? '30d' : '1d';
    const token = jwt.sign({
      userId: user._id,
      role: user.role
    }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: tokenExpiration });

    if (process.env.NODE_ENV !== 'production') {
      console.log('Login successful');
    }
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status || (user.isActive === false ? 'inactive' : 'active'),
        patientId: user.role === 'patient' ? user.patientId : undefined
      },
      redirectTo,
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

    console.log('Clerk sync - Looking for user with:', { clerkId, email });
    
    // First check by Clerk ID (most specific)
    let user = await User.findOne({ clerkId: clerkId });
    console.log('Clerk sync - Found by Clerk ID:', user ? { id: user._id, email: user.email, patientId: user.patientId } : 'null');
    
    // If not found by Clerk ID, check by email ONLY if no Clerk ID exists for that email
    if (!user) {
      const existingUserWithEmail = await User.findOne({ email: email });
      if (existingUserWithEmail && existingUserWithEmail.clerkId) {
        // User exists with this email but different Clerk ID - this is a conflict
        console.log('Clerk sync - Email conflict detected:', {
          existingUserId: existingUserWithEmail._id,
          existingClerkId: existingUserWithEmail.clerkId,
          newClerkId: clerkId,
          email: email
        });
        return res.status(400).json({ 
          message: 'This email is already associated with a different Google account. Please use the original Google account or contact support.',
          conflict: true
        });
      }
      
      // Only link to existing user if they have NO auth provider (local account without Google)
      if (existingUserWithEmail && !existingUserWithEmail.authProvider) {
        user = existingUserWithEmail;
        console.log('Clerk sync - Linking to existing local account:', { id: user._id, email: user.email, patientId: user.patientId });
      } else if (existingUserWithEmail && existingUserWithEmail.authProvider === 'local') {
        // Local account exists - don't link, create new account
        console.log('Clerk sync - Local account exists, creating new Google account:', { email: email, clerkId: clerkId });
        user = null; // Force creation of new account
      } else {
        user = existingUserWithEmail;
        console.log('Clerk sync - Found by email (no conflict):', user ? { id: user._id, email: user.email, patientId: user.patientId } : 'null');
      }
    }

    let isNewUser = false;

    if (user) {
      // Update existing user and check for admin role
      // Only update Clerk ID if it's not already set
      if (!user.clerkId) {
        user.clerkId = clerkId;
      }
      user.name = name || user.name;
      user.phone = phone || user.phone;
      
      // Handle profile image upload to Cloudinary
      if (profileImage && profileImage !== user.profileImage) {
        try {
          const uploadResult = await CloudinaryService.uploadGoogleProfileImage(profileImage, user._id.toString());
          if (uploadResult.success) {
            user.profileImage = uploadResult.url;
            user.profile_photo = uploadResult.url; // Also set profile_photo for compatibility
          } else {
            console.error('Failed to upload Google profile image:', uploadResult.error);
            user.profileImage = profileImage; // Fallback to original URL
          }
        } catch (error) {
          console.error('Error uploading Google profile image:', error);
          user.profileImage = profileImage; // Fallback to original URL
        }
      }
      
      user.isVerified = true;
      user.authProvider = 'clerk';

      // Check if this should be an admin user
      if (email === process.env.ADMIN_EMAIL && user.role !== 'admin') {
        user.role = 'admin';
        user.admin_info = {
          permissions: ['all']
        };
      }

      await user.save();
    } else {
      // Create new user - default to patient role, but check for admin
      isNewUser = true;
      const userRole = email === process.env.ADMIN_EMAIL ? 'admin' : 'patient';

      // Handle profile image upload to Cloudinary for new users
      let finalProfileImage = '';
      if (profileImage) {
        try {
          const uploadResult = await CloudinaryService.uploadGoogleProfileImage(profileImage, 'temp-' + Date.now());
          if (uploadResult.success) {
            finalProfileImage = uploadResult.url;
          } else {
            console.error('Failed to upload Google profile image for new user:', uploadResult.error);
            finalProfileImage = profileImage; // Fallback to original URL
          }
        } catch (error) {
          console.error('Error uploading Google profile image for new user:', error);
          finalProfileImage = profileImage; // Fallback to original URL
        }
      }

      user = new User({
        clerkId,
        email,
        name: name || 'User',
        phone: phone || '',
        profileImage: finalProfileImage,
        profile_photo: finalProfileImage, // Also set profile_photo for compatibility
        isVerified: true,
        authProvider: 'clerk',
        role: userRole,
        patient_info: userRole === 'patient' ? {
          family_members: [],
          booking_history: []
        } : undefined,
        admin_info: userRole === 'admin' ? {
          permissions: ['all']
        } : undefined
      });
      
      console.log('Clerk sync - Creating new user:', {
        clerkId: user.clerkId,
        email: user.email,
        name: user.name,
        role: user.role,
        authProvider: user.authProvider
      });
      
      await user.save();
      
      console.log('Clerk sync - New user created successfully:', {
        id: user._id,
        email: user.email,
        patientId: user.patientId,
        clerkId: user.clerkId
      });
    }

    // Use the role field directly
    const userRole = user.role;

    // Create JWT token
    const token = jwt.sign({
      userId: user._id,
      role: userRole
    }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '1d' });

    // Check if profile is complete
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
        role: userRole
      },
      isNewUser,
      isProfileComplete,
      message: 'User synchronized successfully'
    });

  } catch (error) {
    console.error('Clerk sync error:', error);
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

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
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

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
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

    // Log token for development convenience
    console.log('[Password Reset] Generated token for', email, '=>', resetToken);

    // Send password reset email with link
    await sendPasswordResetEmail(email, resetToken);

    // In non-production, also include the token in the response to ease local testing
    const isProd = process.env.NODE_ENV === 'production';
    res.json({
      message: 'Password reset link sent to your email',
      ...(isProd ? {} : { devToken: resetToken })
    });
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




