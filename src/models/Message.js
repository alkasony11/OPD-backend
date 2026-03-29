const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  recipient_type: {
    type: String,
    enum: ['patient', 'doctor', 'all_patients', 'all_doctors'],
    required: true
  },
  recipient_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  recipient_name: {
    type: String,
    required: true
  },
  recipient_email: {
    type: String,
    required: true
  },
  recipient_phone: {
    type: String,
    default: ''
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['notification', 'announcement', 'reminder', 'alert'],
    default: 'notification'
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read', 'failed'],
    default: 'sent'
  },
  sent_at: {
    type: Date,
    default: Date.now
  },
  delivered_at: {
    type: Date,
    default: null
  },
  read_at: {
    type: Date,
    default: null
  },
  sent_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

// Indexes for better query performance
messageSchema.index({ recipient_id: 1, createdAt: -1 });
messageSchema.index({ recipient_type: 1, createdAt: -1 });
messageSchema.index({ status: 1, createdAt: -1 });
messageSchema.index({ sent_by: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
