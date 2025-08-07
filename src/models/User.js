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

// Password Reset Token Schema
const passwordResetTokenSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  used: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now
  }
}, {
  timestamps: true
});

// Auto-delete expired tokens
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { 
    type: String, 
    required: function() { return !this.clerkId; }
  },
  phone: { type: String, default: '' },
  dob: { type: Date },
  gender: { type: String },
  clerkId: { type: String },
  profileImage: { type: String },
  role: {
    type: String,
    enum: ['patient', 'doctor', 'receptionist', 'admin'],
    default: 'patient'
  },
  profile_photo: { type: String, default: '' },
  isVerified: { type: Boolean, default: false },
  authProvider: {
    type: String,
    enum: ['local', 'clerk'],
    default: 'local'
  },
  
  // Role-specific nested fields
  patient_info: {
    family_members: [{
      member_id: mongoose.Schema.Types.ObjectId,
      name: String,
      age: Number,
      relation: String,
      gender: String,
      medical_history: [String]
    }],
    booking_history: [mongoose.Schema.Types.ObjectId]
  },
  
  doctor_info: {
    department: String,
    specialization: String,
    experience_years: Number,
    calendar: [{
      date: Date,
      is_available: Boolean,
      start_time: String,
      end_time: String,
      leave_reason: String
    }],
    status: {
      type: String,
      enum: ['active', 'on_leave'],
      default: 'active'
    }
  },
  
  receptionist_info: {
    department: String
  },
  
  admin_info: {
    permissions: [String]
  }
}, {
  timestamps: true
});

const User = mongoose.model('User', userSchema);
const OTP = mongoose.model('OTP', otpSchema);
const PasswordResetToken = mongoose.model('PasswordResetToken', passwordResetTokenSchema);

module.exports = { User, OTP, PasswordResetToken };


