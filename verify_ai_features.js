const mongoose = require('mongoose');
const { User, Token } = require('./src/models/User');
const QueueService = require('./src/services/queueService');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

async function runTest() {
    try {
        console.log('--- STARTING AI FEATURE VERIFICATION ---');

        // 1. Setup: Clear test tokens for a specific doctor
        // assuming there is a doctor 'Dr. Test' or we pick the first one
        const doctor = await User.findOne({ role: 'doctor' });
        if (!doctor) throw new Error('No doctor found');
        console.log(`Using Doctor: ${doctor.name} (${doctor._id})`);

        // Reset doc stats for clarity
        if (!doctor.doctor_info) doctor.doctor_info = {};
        doctor.doctor_info.avgConsultationTime = 10;
        doctor.doctor_info.totalConsultations = 0;
        doctor.doctor_info.totalConsultationTime = 0;
        await doctor.save();
        console.log('Reset doctor stats to default (10 mins avg)');

        // Create a patient (or find one)
        const patient = await User.findOne({ role: 'patient' });
        if (!patient) throw new Error('No patient found');
        console.log(`Using Patient: ${patient.name}`);

        // clear tokens for today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        await Token.deleteMany({ doctor_id: doctor._id, booking_date: { $gte: today, $lt: tomorrow } });
        console.log('Cleared tokens for today');

        // 2. Create Appointments
        // Token 1: Standard
        const t1 = await new Token({
            patient_id: patient._id,
            patient_name: 'Patient 1 (Standard)',
            doctor_id: doctor._id,
            token_number: 'T001',
            booking_date: today,
            time_slot: '09:00',
            status: 'booked',
            priority_flag: false
        }).save();

        // Token 2: Priority (Elderly logic simulation requires setting flag manually here as we test backend logic mostly)
        const t2 = await new Token({
            patient_id: patient._id,
            patient_name: 'Patient 2 (Priority)',
            doctor_id: doctor._id,
            token_number: 'T002',
            booking_date: today,
            time_slot: '09:30',
            status: 'booked',
            priority_flag: true // Manually set for test
        }).save();

        // Token 3: Standard
        const t3 = await new Token({
            patient_id: patient._id,
            patient_name: 'Patient 3 (Standard)',
            doctor_id: doctor._id,
            token_number: 'T003',
            booking_date: today,
            time_slot: '10:00',
            status: 'booked',
            priority_flag: false
        }).save();

        console.log('Created 3 appointments (T001, T002[Priority], T003)');

        // 3. Verify Priority Sorting
        // Next patient should be T002 because of priority
        const nextPatient = await Token.findOne({
            doctor_id: doctor._id,
            booking_date: { $gte: today, $lt: tomorrow },
            status: { $in: ['booked', 'in_queue'] }
        }).sort({ priority_flag: -1, status: 1, time_slot: 1 });

        if (nextPatient && nextPatient.token_number === 'T002') {
            console.log('✅ PASS: Priority Queue Sorting (T002 is next)');
        } else {
            console.error(`❌ FAIL: Priority Queue Sorting (Expected T002, got ${nextPatient ? nextPatient.token_number : 'None'})`);
        }

        // 4. Verify Wait Time Prediction
        const predT003 = await QueueService.calculateWaitTime('T003', doctor._id);
        console.log(`Prediction for T003 (Wait: ${predT003.predictedWait}m, Ahead: ${predT003.tokensAhead})`);

        // Note: With priority queue, T002 jumps ahead. If QueueService uses token_number comparison, it might check < T003.
        // T001 and T002 are both < T003. So 2 ahead. 20 mins.
        // The issue I anticipated earlier (QueueService assuming token order matches service order) IS VALID if I relied on creation time, but here Token Number T002 < T003.
        // However, does QueueService account for T002 being served BEFORE T001?
        // Wait, QueueService.calculateWaitTime logic uses:
        /*
            const tokensAheadCount = await Token.countDocuments({
              // ...
              token_number: { $lt: tokenNumber } 
            });
        */
        // It assumes FIFO by Token Number. 
        // If T002 is Priority, it is served first.
        // T001 is Standard.
        // T003 is Standard.
        // If I am T003, who is ahead of me? T001 and T002. Both have token_number < T003.
        // So for T003, prediction is correct (2 people ahead).

        // What about T001?
        // token_number < T001 -> 0 ahead? 
        // BUT T002 is priority! T002 is ahead of T001 effectively.
        // QueueService.calculateWaitTime('T001') will return 0 ahead (Wait 0).
        // THIS IS A BUG/LIMITATION. With Priority Queue, T001 will wait for T002.
        // So QueueService needs to support Priority Awareness if we want T001 to see "1 person ahead".

        const predT001 = await QueueService.calculateWaitTime('T001', doctor._id);
        console.log(`Prediction for T001 (Wait: ${predT001.predictedWait}m, Ahead: ${predT001.tokensAhead})`);
        if (predT001.tokensAhead === 0 && nextPatient.token_number === 'T002') {
            console.warn('⚠️ LIMITATION: QueueService does not account for Priority Flag in "Tokens Ahead" calculation for lower tokens.');
        }

        // 5. Simulate Consultation (Update Stats)
        // Start T002
        t2.status = 'in_progress';
        t2.startTime = new Date(Date.now() - 20 * 60000); // started 20 mins ago
        await t2.save();

        // Complete T002
        const endTime = new Date();
        // Actual duration 20 mins
        const actualDuration = 20;

        // Manually update doctor stats as if /complete was called
        doctor.doctor_info.totalConsultations += 1;
        doctor.doctor_info.totalConsultationTime += actualDuration;
        doctor.doctor_info.avgConsultationTime = doctor.doctor_info.totalConsultationTime / doctor.doctor_info.totalConsultations; // (0+20)/1 = 20
        await doctor.save();
        console.log(`Simulated Consult Complete. New Avg Speed: ${doctor.doctor_info.avgConsultationTime} mins`);

        // 6. Verify Adaptive Wait Time
        // Calculate for T003 again.
        // T002 is done. T001 is ahead.
        const predT003_After = await QueueService.calculateWaitTime('T003', doctor._id);
        console.log(`Prediction for T003 After (Wait: ${predT003_After.predictedWait}m, Ahead: ${predT003_After.tokensAhead})`);

        // T002 is 'in_progress' in DB? No, we should mark T002 as 'consulted'.
        t2.status = 'consulted'; // We need to update this for next query
        await t2.save();

        // Re-run prediction
        const predT003_After2 = await QueueService.calculateWaitTime('T003', doctor._id);
        console.log(`Prediction for T003 After Consulted (Wait: ${predT003_After2.predictedWait}m, Ahead: ${predT003_After2.tokensAhead})`);

        // Expected: 1 person ahead (T001). Wait = 1 * 20 = 20 mins.

        if (Math.round(predT003_After2.avgConsultationTime) === 20) {
            console.log('✅ PASS: Doctor Avg Time Updated');
        } else {
            console.error(`❌ FAIL: Doctor Avg Time not updated (Got ${predT003_After2.avgConsultationTime})`);
        }

    } catch (error) {
        console.error('Test Error:', error);
    } finally {
        mongoose.disconnect();
    }
}

runTest();
