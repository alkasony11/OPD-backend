const mongoose = require('mongoose');
const { Counter } = require('./User');

const familyMemberSchema = new mongoose.Schema({
  patient_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  patientId: {
    type: String,
    unique: true,
    sparse: true
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

// Helper to left-pad numbers with zeros
function padNumberWithZeros(number, width) {
  const numberString = String(number);
  if (numberString.length >= width) return numberString;
  return '0'.repeat(width - numberString.length) + numberString;
}

// Assign sequential Patient ID for new family members
familyMemberSchema.pre('save', async function(next) {
  try {
    if (!this.isNew) return next();
    if (this.patientId) return next();

    const updated = await Counter.findOneAndUpdate(
      { key: 'family_member' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const nextSeq = updated.seq;
    this.patientId = `FM${padNumberWithZeros(nextSeq, 4)}`;
    return next();
  } catch (error) {
    return next(error);
  }
});

// Indexes for better query performance
familyMemberSchema.index({ patient_id: 1 });
familyMemberSchema.index({ patient_id: 1, isActive: 1 });

const FamilyMember = mongoose.model('FamilyMember', familyMemberSchema);

module.exports = FamilyMember;