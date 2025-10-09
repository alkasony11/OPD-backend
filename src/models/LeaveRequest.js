const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema({
  doctor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  leave_type: {
    type: String,
    enum: ['full_day', 'half_day'],
    default: 'full_day'
  },
  start_date: {
    type: Date,
    required: true
  },
  end_date: {
    type: Date,
    required: true
  },
  session: {
    type: String,
    enum: ['morning', 'afternoon'],
    default: 'morning'
  },
  reason: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending'
  },
  admin_comment: {
    type: String,
    default: ''
  },
  cancelled_at: {
    type: Date
  },
  cancelled_by: {
    type: String,
    enum: ['doctor', 'admin']
  }
}, { timestamps: true });

// Useful indexes for queries
leaveRequestSchema.index({ doctor_id: 1, start_date: 1, end_date: 1 }, { name: 'doctor_start_end_idx' });
leaveRequestSchema.index({ doctor_id: 1, status: 1 });
leaveRequestSchema.index({ status: 1, start_date: 1 });

const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);

// One-time cleanup: drop obsolete unique index created by older schema (doctor_id + date)
// If it doesn't exist, the call is ignored.
if (mongoose.connection && mongoose.connection.readyState) {
  const dropObsolete = async () => {
    try {
      await LeaveRequest.collection.dropIndex('doctor_id_1_date_1');
      // eslint-disable-next-line no-console
      console.log('Dropped obsolete index doctor_id_1_date_1 from leaverequests');
    } catch (err) {
      // Ignore if index is not found
      if (err && err.codeName !== 'IndexNotFound' && err.code !== 27) {
        console.warn('Could not drop obsolete index doctor_id_1_date_1:', err.message || err);
      }
    }
  };
  if (mongoose.connection.readyState === 1) {
    dropObsolete();
  } else {
    mongoose.connection.once('open', dropObsolete);
  }
}

module.exports = LeaveRequest;

