require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/opd';
  console.log('Connecting to Mongo:', uri.replace(/:\/\/.+@/, '://<hidden>@'));
  await mongoose.connect(uri);

  const db = mongoose.connection.db;
  const coll = db.collection('leaverequests');

  try {
    const indexes = await coll.indexes();
    console.log('Current indexes:', indexes.map(i => i.name));
  } catch (e) {
    console.warn('Could not list indexes:', e.message);
  }

  // Drop legacy unique index if present
  try {
    await coll.dropIndex('doctor_id_1_date_1');
    console.log('Dropped index doctor_id_1_date_1');
  } catch (e) {
    if (e.codeName === 'IndexNotFound' || e.code === 27) {
      console.log('Index doctor_id_1_date_1 not present. Skipping.');
    } else {
      console.error('Failed to drop index doctor_id_1_date_1:', e.message);
    }
  }

  // Ensure intended helpful indexes exist (non-unique)
  try {
    await coll.createIndex({ doctor_id: 1, start_date: 1, end_date: 1 }, { name: 'doctor_start_end_idx' });
    await coll.createIndex({ doctor_id: 1, status: 1 }, { name: 'doctor_status_idx' });
    await coll.createIndex({ status: 1, start_date: 1 }, { name: 'status_start_idx' });
    console.log('Ensured non-unique helpful indexes');
  } catch (e) {
    console.error('Failed to create indexes:', e.message);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});


