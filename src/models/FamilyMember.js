const mongoose = require('mongoose');

const familyMemberSchema = new mongoose.Schema({
  patient_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  age: {
    type: Number,
    required: true,
    min: 0,
    max: 150
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    required: true
  },
  relation: {
    type: String,
    required: true,
    enum: ['spouse', 'child', 'parent', 'sibling', 'grandparent', 'grandchild', 'other']
  },
  phone: {
    type: String,
    default: ''
  },
  medical_history: [{
    condition: String,
    diagnosed_date: Date,
    notes: String
  }],
  allergies: [{
    type: String,
    trim: true
  }],
  emergency_contact: {
    name: String,
    phone: String,
    relation: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
familyMemberSchema.index({ patient_id: 1 });
familyMemberSchema.index({ patient_id: 1, isActive: 1 });

const FamilyMember = mongoose.model('FamilyMember', familyMemberSchema);

module.exports = FamilyMember;