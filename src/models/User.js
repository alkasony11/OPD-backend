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

// Counter schema for generating sequential IDs (e.g., Patient IDs)
const counterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 }
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { 
    type: String, 
    required: function() { return !this.clerkId; }
  },
  phone: { type: String, default: '' },
  age: { type: Number },
  dob: { type: Date },
  gender: { type: String },
  address: { type: String, default: '' },
  bloodGroup: { type: String, default: '' },
  allergies: { type: String, default: '' },
  chronicConditions: { type: String, default: '' },
  emergencyContact: {
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    relation: { type: String, default: '' }
  },
  account_settings: {
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false }
    },
    privacy: {
      familyAccess: { type: Boolean, default: true },
      bookingHistory: { type: Boolean, default: true }
    },
    preferences: {
      preferredDoctor: { type: String, default: '' },
      preferredDepartment: { type: String, default: '' },
      language: { type: String, default: 'en' }
    }
  },
  settings: {
    notifications: {
      emailNotifications: { type: Boolean, default: true },
      smsNotifications: { type: Boolean, default: true },
      appointmentReminders: { type: Boolean, default: true },
      prescriptionReady: { type: Boolean, default: true },
      paymentReminders: { type: Boolean, default: true }
    },
    privacy: {
      profileVisibility: { type: String, enum: ['public', 'private'], default: 'private' },
      shareMedicalData: { type: Boolean, default: false },
      allowDataCollection: { type: Boolean, default: true }
    }
  },
  isActive: { type: Boolean, default: true },
  deactivatedAt: { type: Date },
  clerkId: { type: String },
  profileImage: { type: String },
  role: {
    type: String,
    enum: ['patient', 'doctor', 'receptionist', 'admin'],
    default: 'patient'
  },
  patientId: { type: String, unique: true, sparse: true },
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
    booking_history: [mongoose.Schema.Types.ObjectId],
    wallet_balance: {
      type: Number,
      default: 0
    }
  },
  
  // Patient management fields
  isBlocked: { type: Boolean, default: false },
  blockReason: { type: String, default: '' },
  blockHistory: [{
    reason: String,
    blockedAt: { type: Date, default: Date.now },
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    unblockedAt: Date,
    unblockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  
  doctor_info: {
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department'
    },
    specialization: String,
    experience_years: Number,
    consultation_fee: {
      type: Number,
      default: 500
    },
    video_fee: {
      type: Number,
      default: 0
    },
    followup_fee: {
      type: Number,
      default: 0
    },
    qualifications: String,
    certifications: String,
    license_number: String,
    bio: String,
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
    },
    consultation_type: {
      type: String,
      enum: ['physical', 'video', 'both'],
      default: 'physical'
    },
    default_working_hours: {
      start_time: {
        type: String,
        default: '09:00'
      },
      end_time: {
        type: String,
        default: '17:00'
      }
    },
    default_break_time: {
      start_time: {
        type: String,
        default: '13:00'
      },
      end_time: {
        type: String,
        default: '14:00'
      }
    },
    default_slot_duration: {
      type: Number,
      default: 30
    },
    employment_type: {
      type: String,
      enum: ['full-time', 'part-time', 'visiting'],
      default: 'full-time'
    },
    active_days: {
      type: [String],
      default: ['Mon','Tue','Wed','Thu','Fri']
    }
  },
  
  receptionist_info: {
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department'
    }
  },
  
  admin_info: {
    permissions: [String]
  }
}, {
  timestamps: true
});

// Helper to left-pad numbers with zeros
function padNumberWithZeros(number, width) {
  const numberString = String(number);
  if (numberString.length >= width) return numberString;
  return '0'.repeat(width - numberString.length) + numberString;
}

// Assign sequential Patient ID for new patient users
userSchema.pre('save', async function(next) {
  try {
    if (!this.isNew) return next();
    if (this.role !== 'patient') return next();
    if (this.patientId) return next();

    const Counter = mongoose.model('Counter', counterSchema);
    const updated = await Counter.findOneAndUpdate(
      { key: 'patient' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const nextSeq = updated.seq;
    this.patientId = `P${padNumberWithZeros(nextSeq, 3)}`;
    return next();
  } catch (error) {
    return next(error);
  }
});

// Appointment Schema
const appointmentSchema = new mongoose.Schema({
  // Patient Information
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  patientName: {
    type: String,
    required: true
  },
  patientEmail: {
    type: String,
    required: true
  },
  patientPhone: {
    type: String,
    required: true
  },

  // Doctor Information
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  doctorName: {
    type: String,
    required: true
  },

  // Appointment Details
  appointmentDate: {
    type: Date,
    required: true
  },
  appointmentTime: {
    type: String,
    required: true
  },
  department: {
    type: String,
    required: true
  },
  appointmentType: {
    type: String,
    enum: ['consultation', 'follow-up', 'emergency', 'routine-checkup'],
    default: 'consultation'
  },

  // Status and Progress
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show'],
    default: 'pending'
  },

  // Medical Information
  symptoms: {
    type: String,
    required: true
  },
  diagnosis: {
    type: String,
    default: ''
  },

  // Doctor's Notes and Prescriptions
  doctorNotes: {
    type: String,
    default: ''
  },
  prescriptions: [{
    medicationName: {
      type: String,
      required: true
    },
    dosage: {
      type: String,
      required: true
    },
    frequency: {
      type: String,
      required: true
    },
    duration: {
      type: String,
      required: true
    },
    instructions: {
      type: String,
      default: ''
    },
    prescribedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Booking Information
  tokenNumber: {
    type: String,
    unique: true,
    sparse: true
  },
  estimatedWaitTime: {
    type: Number,
    default: 0
  },

  // Payment Information
  paymentMethod: {
    type: String,
    enum: ['card', 'cash', 'insurance'],
    default: 'cash'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded'],
    default: 'pending'
  },
  consultationFee: {
    type: Number,
    default: 0
  },

  // Timestamps
  bookedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  cancellationReason: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes for better query performance
appointmentSchema.index({ doctorId: 1, appointmentDate: 1 });
appointmentSchema.index({ patientId: 1, appointmentDate: 1 });
appointmentSchema.index({ status: 1 });
appointmentSchema.index({ tokenNumber: 1 });

// Token Schema (for your tokens collection)
const tokenSchema = new mongoose.Schema({
  patient_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  patient_name: {
    type: String,
    required: true
  },
  patient_email: {
    type: String,
    required: true
  },
  family_member_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FamilyMember'
  },
  doctor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  department: {
    type: String,
    required: true
  },
  symptoms: {
    type: String,
    required: true
  },
  booking_date: {
    type: Date,
    required: true
  },
  time_slot: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['booked', 'in_queue', 'consulted', 'cancelled', 'missed', 'referred'],
    default: 'booked'
  },
  estimated_wait_time: {
    type: Number,
    default: 0
  },
  payment_status: {
    type: String,
    enum: ['paid', 'pending', 'refunded'],
    default: 'pending'
  },
  priority_flag: {
    type: Boolean,
    default: false
  },
  created_by: {
    type: String,
    enum: ['patient', 'receptionist', 'whatsapp_bot'],
    default: 'patient'
  },
  emergency_redirected: {
    type: Boolean,
    default: false
  },
  token_pdf_url: {
    type: String
  },
  token_number: {
    type: String,
    unique: true,
    sparse: true
  },
  cancellation_reason: {
    type: String,
    default: ''
  },
  session_type: {
    type: String,
    enum: ['morning', 'afternoon', 'evening'],
    required: true
  },
  session_time_range: {
    type: String,
    required: true
  },
  appointment_type: {
    type: String,
    enum: ['in-person', 'video'],
    default: 'in-person'
  },
  meeting_link: {
    meetingId: {
      type: String,
      default: ''
    },
    meetingUrl: {
      type: String,
      default: ''
    },
    meetingPassword: {
      type: String,
      default: ''
    },
    provider: {
      type: String,
      enum: ['jitsi', 'zoom', 'google-meet', 'webrtc'],
      default: 'jitsi'
    },
    expiresAt: {
      type: Date
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  consultation_notes: {
    type: String,
    default: ''
  },
  diagnosis: {
    type: String,
    default: ''
  },
  referredDoctor: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  prescriptions: [{
    medication_name: {
      type: String,
      required: true
    },
    dosage: {
      type: String,
      required: true
    },
    frequency: {
      type: String,
      required: true
    },
    duration: {
      type: String,
      required: true
    },
    instructions: {
      type: String,
      default: ''
    },
    prescribed_at: {
      type: Date,
      default: Date.now
    }
  }],
  consultation_started_at: {
    type: Date
  },
  consultation_completed_at: {
    type: Date
  },
  cancelled_at: {
    type: Date
  },
  cancelled_by: {
    type: String,
    enum: ['patient', 'doctor', 'receptionist', 'admin'],
    default: 'patient'
  },
  refund_status: {
    type: String,
    enum: ['none', 'pending', 'processed', 'failed'],
    default: 'none'
  },
  refund_amount: {
    type: Number,
    default: 0
  },
  refund_method: {
    type: String,
    enum: ['wallet', 'upi', 'card', 'cash'],
    default: 'wallet'
  },
  refund_reference: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Indexes for better query performance
tokenSchema.index({ doctor_id: 1, booking_date: 1 });
tokenSchema.index({ patient_id: 1, booking_date: 1 });
tokenSchema.index({ status: 1 });
tokenSchema.index({ token_number: 1 });

const User = mongoose.model('User', userSchema);
const Counter = mongoose.model('Counter', counterSchema);
const OTP = mongoose.model('OTP', otpSchema);
const PasswordResetToken = mongoose.model('PasswordResetToken', passwordResetTokenSchema);
const Appointment = mongoose.model('Appointment', appointmentSchema);
const Token = mongoose.model('Token', tokenSchema);

module.exports = { User, OTP, PasswordResetToken, Appointment, Token, Counter };


