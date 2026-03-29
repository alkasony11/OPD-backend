const mongoose = require('mongoose');
const { Token, User } = require('./src/models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        // Create random doctor IDs for testing (Mongoose ObjectIds)
        const doc1 = new mongoose.Types.ObjectId();
        const doc2 = new mongoose.Types.ObjectId();
        // Use an existing patient or random
        const patient1 = await User.findOne({ role: 'patient' });

        if (!patient1) { console.log('No patient found, skipping'); process.exit(0); }

        const today = new Date();

        try {
            console.log('Attempting to create T001 for Doc 1...');
            await Token.create({
                token_number: 'T001',
                doctor_id: doc1,
                booking_date: today,
                status: 'booked',
                patient_id: patient1._id,
                patient_name: 'Test 1',
                patient_email: 'test@test.com',
                department: 'Cardiology',
                symptoms: 'Test',
                time_slot: '09:00',
                session_type: 'morning',
                session_time_range: '09:00-13:00'
            });
            console.log('✅ Created T001 for Doc 1');

            console.log('Attempting to create T001 for Doc 2 (Should succeed now)...');
            await Token.create({
                token_number: 'T001', // SAME TOKEN NUMBER
                doctor_id: doc2,      // DIFFERENT DOCTOR
                booking_date: today,
                status: 'booked',
                patient_id: patient1._id,
                patient_name: 'Test 2',
                patient_email: 'test@test.com',
                department: 'Pediatrics',
                symptoms: 'Test',
                time_slot: '09:00',
                session_type: 'morning',
                session_time_range: '09:00-13:00'
            });
            console.log('✅ Created T001 for Doc 2 - SUCCESS!');

        } catch (error) {
            console.error('❌ Failed:', error.message);
        } finally {
            // cleanup
            await Token.deleteOne({ doctor_id: doc1, token_number: 'T001' });
            await Token.deleteOne({ doctor_id: doc2, token_number: 'T001' });
            mongoose.disconnect();
        }
    })
    .catch(err => console.error(err));
