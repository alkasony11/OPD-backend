const mongoose = require('mongoose');

// OTP Schema for email verification and password reset
const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true
  },
  otp: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['registration', 'password_reset'],
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000) // 10 minutes from now
  }
}, {
  timestamps: true
});

// Auto-delete expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: function() {
      // Password is required only if clerkId is not present
      return !this.clerkId;
    }
  },
  phone: {
    type: String,
    default: ''
  },
  dob: {
    type: Date
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    default: ''
  },
  clerkId: {
    type: String,
    unique: true,
    sparse: true // Allows null values while maintaining uniqueness
  },
  profileImage: {
    type: String,
    default: ''
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  authProvider: {
    type: String,
    enum: ['local', 'clerk'],
    default: 'local'
  }
}, {
  timestamps: true
});

const User = mongoose.model('User', userSchema);
const OTP = mongoose.model('OTP', otpSchema);

module.exports = { User, OTP };
