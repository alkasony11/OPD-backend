const mongoose = require('mongoose');

const consultationRecordSchema = new mongoose.Schema({
  appointment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Token',
    required: true
  },
  doctor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  patient_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  consultationData: {
    chiefComplaint: {
      type: String,
      default: ''
    },
    historyOfPresentIllness: {
      type: String,
      default: ''
    },
    physicalExamination: {
      type: String,
      default: ''
    },
    vitalSigns: {
      bloodPressure: {
        type: String,
        default: ''
      },
      heartRate: {
        type: String,
        default: ''
      },
      temperature: {
        type: String,
        default: ''
      },
      respiratoryRate: {
        type: String,
        default: ''
      },
      oxygenSaturation: {
        type: String,
        default: ''
      }
    },
    diagnosis: {
      type: String,
      default: ''
    },
    treatmentPlan: {
      type: String,
      default: ''
    },
    medications: {
      type: String,
      default: ''
    },
    followUpInstructions: {
      type: String,
      default: ''
    },
    additionalNotes: {
      type: String,
      default: ''
    }
  },
  status: {
    type: String,
    enum: ['draft', 'completed'],
    default: 'draft'
  },
  consultation_date: {
    type: Date,
    default: Date.now
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
consultationRecordSchema.index({ appointment_id: 1 });
consultationRecordSchema.index({ doctor_id: 1 });
consultationRecordSchema.index({ patient_id: 1 });
consultationRecordSchema.index({ consultation_date: -1 });

module.exports = mongoose.model('ConsultationRecord', consultationRecordSchema);
