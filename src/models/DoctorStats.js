const mongoose = require('mongoose');

// Doctor Statistics Model for caching dashboard stats
const doctorStatsSchema = new mongoose.Schema({
  doctor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  
  // Daily stats
  today_appointments: {
    type: Number,
    default: 0
  },
  today_completed: {
    type: Number,
    default: 0
  },
  today_cancelled: {
    type: Number,
    default: 0
  },
  today_pending: {
    type: Number,
    default: 0
  },
  
  // Monthly stats
  month_appointments: {
    type: Number,
    default: 0
  },
  month_completed: {
    type: Number,
    default: 0
  },
  month_revenue: {
    type: Number,
    default: 0
  },
  
  // Overall stats
  total_patients: {
    type: Number,
    default: 0
  },
  total_appointments: {
    type: Number,
    default: 0
  },
  total_completed: {
    type: Number,
    default: 0
  },
  
  // Performance metrics
  average_consultation_time: {
    type: Number,
    default: 0 // in minutes
  },
  patient_satisfaction_rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  
  // Availability stats
  working_days_this_month: {
    type: Number,
    default: 0
  },
  leave_days_this_month: {
    type: Number,
    default: 0
  },
  
  // Last updated timestamp
  last_calculated: {
    type: Date,
    default: Date.now
  },
  
  // Cache validity (stats are recalculated if older than this)
  cache_expires_at: {
    type: Date,
    default: () => new Date(Date.now() + 60 * 60 * 1000) // 1 hour cache
  }
}, {
  timestamps: true
});

// Indexes for performance
doctorStatsSchema.index({ doctor_id: 1 });
doctorStatsSchema.index({ last_calculated: 1 });
doctorStatsSchema.index({ cache_expires_at: 1 });

// Method to check if stats need refresh
doctorStatsSchema.methods.needsRefresh = function() {
  return new Date() > this.cache_expires_at;
};

// Static method to get or create stats for a doctor
doctorStatsSchema.statics.getOrCreate = async function(doctorId) {
  let stats = await this.findOne({ doctor_id: doctorId });
  
  if (!stats) {
    stats = new this({ doctor_id: doctorId });
    await stats.save();
  }
  
  return stats;
};

const DoctorStats = mongoose.model('DoctorStats', doctorStatsSchema);

module.exports = DoctorStats;