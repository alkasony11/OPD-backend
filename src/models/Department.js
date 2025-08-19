const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  icon: {
    type: String,
    default: 'hospital'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  services: [{
    type: String,
    trim: true
  }],
  head_of_department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Index for faster queries
departmentSchema.index({ name: 1 });
departmentSchema.index({ isActive: 1 });

const Department = mongoose.model('Department', departmentSchema);

module.exports = Department;
