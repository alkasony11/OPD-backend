const mongoose = require('mongoose');

const doctorScheduleSchema = new mongoose.Schema({
  doctor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  is_available: {
    type: Boolean,
    default: true
  },
  working_hours: {
    start_time: {
      type: String,
      required: true,
      default: '09:00'
    },
    end_time: {
      type: String,
      required: true,
      default: '17:00'
    }
  },
  break_time: {
    start_time: {
      type: String,
      default: '13:00'
    },
    end_time: {
      type: String,
      default: '14:00'
    }
  },
  slot_duration: {
    type: Number,
    default: 30 // minutes
  },
  max_patients_per_slot: {
    type: Number,
    default: 1
  },
  booked_slots: [{
    time: String,
    patient_count: {
      type: Number,
      default: 0
    },
    appointments: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment'
    }]
  }],
  leave_reason: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Compound index for doctor and date
doctorScheduleSchema.index({ doctor_id: 1, date: 1 }, { unique: true });
doctorScheduleSchema.index({ doctor_id: 1, is_available: 1 });
doctorScheduleSchema.index({ date: 1, is_available: 1 });

const DoctorSchedule = mongoose.model('DoctorSchedule', doctorScheduleSchema);

module.exports = DoctorSchedule;