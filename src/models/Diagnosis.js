const mongoose = require('mongoose');

const diagnosisSchema = new mongoose.Schema({
  appointment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Token',
    required: true
  },
  patient_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  doctor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Patient Information
  patient_name: {
    type: String,
    required: true
  },
  patient_age: {
    type: Number,
    required: true
  },
  patient_gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    required: true
  },
  patient_phone: {
    type: String,
    required: true
  },
  patient_email: {
    type: String,
    required: true
  },
  
  // Medical History
  chief_complaint: {
    type: String,
    required: true,
    trim: true
  },
  history_of_present_illness: {
    type: String,
    required: true,
    trim: true
  },
  past_medical_history: {
    type: String,
    default: '',
    trim: true
  },
  family_history: {
    type: String,
    default: '',
    trim: true
  },
  social_history: {
    type: String,
    default: '',
    trim: true
  },
  
  // Physical Examination
  vital_signs: {
    blood_pressure: {
      systolic: { type: Number, default: null },
      diastolic: { type: Number, default: null }
    },
    heart_rate: { type: Number, default: null },
    temperature: { type: Number, default: null },
    respiratory_rate: { type: Number, default: null },
    oxygen_saturation: { type: Number, default: null },
    weight: { type: Number, default: null },
    height: { type: Number, default: null }
  },
  
  physical_examination: {
    general_appearance: { type: String, default: '', trim: true },
    cardiovascular: { type: String, default: '', trim: true },
    respiratory: { type: String, default: '', trim: true },
    gastrointestinal: { type: String, default: '', trim: true },
    neurological: { type: String, default: '', trim: true },
    musculoskeletal: { type: String, default: '', trim: true },
    skin: { type: String, default: '', trim: true },
    other: { type: String, default: '', trim: true }
  },
  
  // Assessment and Plan
  assessment: {
    primary_diagnosis: {
      type: String,
      required: true,
      trim: true
    },
    secondary_diagnoses: [{
      diagnosis: { type: String, trim: true },
      icd_code: { type: String, trim: true }
    }],
    differential_diagnosis: [{
      diagnosis: { type: String, trim: true },
      reasoning: { type: String, trim: true }
    }]
  },
  
  treatment_plan: {
    medications: [{
      name: { type: String, required: true, trim: true },
      dosage: { type: String, required: true, trim: true },
      frequency: { type: String, required: true, trim: true },
      duration: { type: String, required: true, trim: true },
      instructions: { type: String, default: '', trim: true }
    }],
    procedures: [{
      name: { type: String, required: true, trim: true },
      description: { type: String, default: '', trim: true },
      date: { type: Date, default: null }
    }],
    lifestyle_modifications: {
      type: String,
      default: '',
      trim: true
    },
    follow_up: {
      type: String,
      default: '',
      trim: true
    },
    referrals: [{
      specialist: { type: String, trim: true },
      reason: { type: String, trim: true },
      urgency: { type: String, enum: ['routine', 'urgent', 'emergency'], default: 'routine' }
    }]
  },
  
  // Investigations
  investigations: {
    laboratory: [{
      test_name: { type: String, required: true, trim: true },
      ordered_date: { type: Date, default: Date.now },
      status: { type: String, enum: ['ordered', 'completed', 'pending'], default: 'ordered' },
      results: { type: String, default: '', trim: true },
      normal_range: { type: String, default: '', trim: true }
    }],
    imaging: [{
      study_type: { type: String, required: true, trim: true },
      body_part: { type: String, required: true, trim: true },
      ordered_date: { type: Date, default: Date.now },
      status: { type: String, enum: ['ordered', 'completed', 'pending'], default: 'ordered' },
      findings: { type: String, default: '', trim: true }
    }],
    other_tests: [{
      test_name: { type: String, required: true, trim: true },
      description: { type: String, default: '', trim: true },
      ordered_date: { type: Date, default: Date.now },
      status: { type: String, enum: ['ordered', 'completed', 'pending'], default: 'ordered' },
      results: { type: String, default: '', trim: true }
    }]
  },
  
  // Additional Information
  notes: {
    type: String,
    default: '',
    trim: true
  },
  prognosis: {
    type: String,
    default: '',
    trim: true
  },
  
  // Consultation Status
  consultation_status: {
    type: String,
    enum: ['in_progress', 'completed', 'cancelled'],
    default: 'in_progress'
  },
  
  // Timestamps
  consultation_start_time: {
    type: Date,
    default: Date.now
  },
  consultation_end_time: {
    type: Date,
    default: null
  },
  
  // Doctor Information
  doctor_name: {
    type: String,
    required: true
  },
  doctor_signature: {
    type: String,
    default: ''
  },
  
  // Department Information
  department: {
    type: String,
    required: true
  }
}, { 
  timestamps: true 
});

// Indexes for better query performance
diagnosisSchema.index({ appointment_id: 1 });
diagnosisSchema.index({ patient_id: 1, createdAt: -1 });
diagnosisSchema.index({ doctor_id: 1, createdAt: -1 });
diagnosisSchema.index({ consultation_status: 1 });
diagnosisSchema.index({ department: 1, createdAt: -1 });

// Virtual for consultation duration
diagnosisSchema.virtual('consultation_duration').get(function() {
  if (this.consultation_end_time && this.consultation_start_time) {
    return Math.round((this.consultation_end_time - this.consultation_start_time) / (1000 * 60)); // in minutes
  }
  return null;
});

// Method to end consultation
diagnosisSchema.methods.endConsultation = function() {
  this.consultation_status = 'completed';
  this.consultation_end_time = new Date();
  return this.save();
};

// Static method to create diagnosis
diagnosisSchema.statics.createDiagnosis = async function(data) {
  const diagnosis = new this(data);
  return await diagnosis.save();
};

module.exports = mongoose.model('Diagnosis', diagnosisSchema);
