const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipient_type: {
    type: String,
    enum: ['doctor', 'patient', 'admin', 'receptionist'],
    required: true
  },
  title: {
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
    enum: ['appointment', 'leave_request', 'schedule_change', 'system', 'payment', 'cancellation'],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  read: {
    type: Boolean,
    default: false
  },
  read_at: {
    type: Date,
    default: null
  },
  // Reference to related entities
  related_id: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  related_type: {
    type: String,
    enum: ['appointment', 'leave_request', 'schedule', 'payment'],
    default: null
  },
  // Additional data for the notification
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { 
  timestamps: true 
});

// Indexes for better query performance
notificationSchema.index({ recipient_id: 1, createdAt: -1 });
notificationSchema.index({ recipient_type: 1, read: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });

// Method to mark as read
notificationSchema.methods.markAsRead = function() {
  this.read = true;
  this.read_at = new Date();
  return this.save();
};

// Static method to create notification
notificationSchema.statics.createNotification = async function(data) {
  const notification = new this({
    recipient_id: data.recipient_id,
    recipient_type: data.recipient_type,
    title: data.title,
    message: data.message,
    type: data.type,
    priority: data.priority || 'normal',
    related_id: data.related_id || null,
    related_type: data.related_type || null,
    metadata: data.metadata || {}
  });
  
  return await notification.save();
};

module.exports = mongoose.model('Notification', notificationSchema);
