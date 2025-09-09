const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema({
  doctor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  reason: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  admin_comment: {
    type: String,
    default: ''
  }
}, { timestamps: true });

leaveRequestSchema.index({ doctor_id: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);

