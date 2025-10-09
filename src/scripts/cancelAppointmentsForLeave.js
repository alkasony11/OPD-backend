require('dotenv').config();
const mongoose = require('mongoose');
const { Token } = require('../models/User');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/opd';
  const doctorId = process.env.CANCEL_DOCTOR_ID; // e.g. 6894e494d149cc4441336e46
  const dateStr = process.env.CANCEL_DATE; // e.g. 2025-10-13
  const leaveType = process.env.CANCEL_LEAVE_TYPE || 'full_day'; // full_day | half_day
  const session = process.env.CANCEL_SESSION || 'morning'; // morning | afternoon (for half_day)

  if (!doctorId || !dateStr) {
    console.error('Set CANCEL_DOCTOR_ID and CANCEL_DATE (YYYY-MM-DD). Optional: CANCEL_LEAVE_TYPE, CANCEL_SESSION');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const day = new Date(dateStr);
  day.setHours(0,0,0,0);
  const next = new Date(day);
  next.setDate(next.getDate() + 1);

  const candidates = await Token.find({
    doctor_id: doctorId,
    booking_date: { $gte: day, $lt: next },
    status: { $in: ['booked', 'in_queue', 'confirmed'] }
  }).select('_id time_slot');

  const idsToCancel = [];
  for (const c of candidates) {
    if (leaveType === 'half_day') {
      const ts = (c.time_slot || '09:00').split(':');
      const hour = parseInt(ts[0] || '9', 10);
      if (session === 'morning' && hour >= 14) continue;
      if (session === 'afternoon' && hour < 14) continue;
    }
    idsToCancel.push(c._id);
  }

  if (idsToCancel.length === 0) {
    console.log('No appointments to cancel.');
  } else {
    const upd = await Token.updateMany(
      { _id: { $in: idsToCancel } },
      { $set: {
          status: 'cancelled_by_hospital',
          cancellation_reason: 'Doctor leave approved',
          cancelled_at: new Date(),
          cancelled_by: 'system'
        }
      }
    );
    console.log(`Cancelled ${upd.modifiedCount || 0} appointments on ${dateStr}`);
  }

  await mongoose.disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });


