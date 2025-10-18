const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  // If logged-in submission, link to patient
  patient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  doctor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  appointment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Token' },
  type: { type: String, enum: ['feedback', 'complaint', 'query'], default: 'feedback' },
  subject: { type: String, default: '' },
  message: { type: String, required: true },
  status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
  admin_notes: { type: String, default: '' },
  // Guest submission fields (when no patient_id)
  guest_name: { type: String, default: '' },
  guest_email: { type: String, default: '' },
  guest_phone: { type: String, default: '' }
}, { timestamps: true });

feedbackSchema.index({ patient_id: 1, createdAt: -1 });
feedbackSchema.index({ status: 1, createdAt: -1 });
feedbackSchema.index({ guest_email: 1, createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);


