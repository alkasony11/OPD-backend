const { User, Token } = require('../models/User');
const { SimpleLinearRegression } = require('ml-regression');  // Use SLR since it works
const Matrix = require('ml-matrix').Matrix;
const fs = require('fs');
const path = require('path');

class MLWaitTimePredictor {
    constructor() {
        this.model = null;
        this.isTrained = false;
        this.modelPath = path.join(__dirname, '../../models/wait_time_model.json');
        this.loadModel();
    }

    /**
     * Load saved model if it exists
     */
    loadModel() {
        try {
            if (fs.existsSync(this.modelPath)) {
                const modelData = JSON.parse(fs.readFileSync(this.modelPath, 'utf8'));
                this.model = SimpleLinearRegression.load(modelData);
                this.isTrained = true;
                console.log('✅ ML model loaded from disk');
            } else {
                console.log('ℹ️ No saved ML model found, will train new one');
            }
        } catch (error) {
            console.error('❌ Error loading ML model:', error);
            this.isTrained = false;
            this.model = null;
        }
    }

    /**
     * Save trained model to disk
     */
    saveModel() {
        try {
            if (this.model && this.isTrained) {
                const modelData = this.model.toJSON();
                fs.writeFileSync(this.modelPath, JSON.stringify(modelData, null, 2));
                console.log('💾 ML model saved to disk');
            }
        } catch (error) {
            console.error('❌ Error saving ML model:', error);
        }
    }

    /**
     * Collect historical appointment data for training
     * @returns {Promise<Array>} Training data with features and labels
     */
    async collectTrainingData() {
        try {
            console.log('📊 Collecting historical appointment data for ML training...');

            // Get completed appointments from the last 90 days
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

            const completedAppointments = await Token.find({
                status: 'consulted',
                booking_date: { $gte: ninetyDaysAgo },
                startTime: { $exists: true },
                endTime: { $exists: true }
            })
            .populate('doctor_id', 'doctor_info')
            .sort({ booking_date: -1 })
            .limit(1000); // Limit to prevent memory issues

            console.log(`📈 Found ${completedAppointments.length} completed appointments for training`);

            const trainingData = [];

            for (const apt of completedAppointments) {
                try {
                    // Calculate actual wait time (time from booking to start)
                    const bookingTime = new Date(apt.booking_date);
                    const startTime = new Date(apt.startTime);
                    const actualWaitTime = Math.max(0, (startTime - bookingTime) / (1000 * 60)); // minutes

                    // Calculate actual consultation time
                    const endTime = new Date(apt.endTime);
                    const actualConsultationTime = Math.max(5, (endTime - startTime) / (1000 * 60)); // minutes

                    // Get queue position at the time of consultation
                    const queuePosition = await this.getHistoricalQueuePosition(apt);

                    // Extract features for ML model
                    const features = [
                        queuePosition, // How many people were ahead
                        apt.doctor_id?.doctor_info?.avgConsultationTime || 10, // Doctor's avg time
                        this.getHourOfDay(apt.time_slot), // Hour of appointment
                        this.getDayOfWeek(apt.booking_date), // Day of week
                        this.getSessionType(apt.session_type), // Morning/afternoon/evening
                        apt.symptoms ? apt.symptoms.length : 0, // Symptom complexity (rough proxy)
                        actualConsultationTime // Previous consultation duration
                    ];

                    // Label: actual wait time experienced
                    const label = actualWaitTime;

                    trainingData.push({ features, label });

                } catch (err) {
                    console.error('Error processing appointment for training:', err);
                }
            }

            console.log(`✅ Collected ${trainingData.length} training samples`);
            return trainingData;

        } catch (error) {
            console.error('❌ Error collecting training data:', error);
            return [];
        }
    }

    /**
     * Get historical queue position for a past appointment
     */
    async getHistoricalQueuePosition(appointment) {
        try {
            const startOfDay = new Date(appointment.booking_date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(startOfDay);
            endOfDay.setHours(23, 59, 59, 999);

            // Count appointments that were active before this one
            const aheadCount = await Token.countDocuments({
                doctor_id: appointment.doctor_id,
                booking_date: { $gte: startOfDay, $lte: endOfDay },
                session_type: appointment.session_type,
                token_number: { $lt: appointment.token_number },
                status: { $in: ['booked', 'confirmed', 'in_queue', 'in_progress', 'consulted'] }
            });

            return aheadCount;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Train the ML model using historical data
     */
    async trainModel() {
        try {
            console.log('🤖 Training ML model for wait time prediction...');

            const trainingData = await this.collectTrainingData();

            if (trainingData.length < 10) {
                console.log('⚠️ Not enough training data, using fallback heuristic');
                this.isTrained = false;
                return false;
            }

            // Prepare data for ML regression using weighted feature aggregation
            // Combine 7 features into a single score: weighted average
            const X = trainingData.map(d => {
                const features = d.features; // [queuePos, docAvg, hour, day, sessionType, symptomLen, prevConsul]
                // Weighted sum: prioritize queue position and doctor avg time
                const weightedScore = (
                    features[0] * 0.35 +      // Queue position (35%)
                    features[1] * 0.30 +      // Doctor avg time (30%)
                    features[2] * 0.10 +      // Hour of day (10%)
                    features[3] * 0.08 +      // Day of week (8%)
                    features[4] * 0.07 +      // Session type (7%)
                    features[5] * 0.05 +      // Symptom complexity (5%)
                    features[6] * 0.05        // Previous consultation (5%)
                );
                return weightedScore;
            });
            const y = trainingData.map(d => d.label);

            console.log(`📊 Data preparation: ${X.length} samples`);
            console.log(`📊 Sample X[0]: ${X[0]}`);
            console.log(`📊 Sample y[0]: ${y[0]}`);

            // Validate data
            if (!Array.isArray(X) || X.length === 0 || !Array.isArray(y) || y.length === 0) {
                throw new Error('Invalid training data arrays');
            }
            if (X.length !== y.length) {
                throw new Error(`X and y length mismatch: ${X.length} vs ${y.length}`);
            }

            // Train simple linear regression on weighted features
            try {
                this.model = new SimpleLinearRegression(X, y);
            } catch (mlError) {
                console.error('❌ ML-Regression init error:', mlError.message);
                throw mlError;
            }

            this.isTrained = true;
            this.saveModel();

            console.log('✅ ML model trained successfully!');
            console.log(`📊 Training data: ${trainingData.length} samples`);
            console.log(`🎯 Features used: queue_position, doctor_avg_time, hour, day_of_week, session_type, symptom_length, prev_consultation_time`);

            return true;

        } catch (error) {
            console.error('❌ Error training ML model:', error);
            this.isTrained = false;
            return false;
        }
    }

    /**
     * Predict wait time using trained ML model
     * @param {string} tokenNumber - Token number
     * @param {string} doctorId - Doctor ID
     * @param {Date} appointmentDate - Appointment date
     * @param {string} timeSlot - Time slot
     * @param {string} sessionType - Session type
     * @param {string} symptoms - Patient symptoms
     * @returns {Promise<Object>} Prediction result
     */
    async predictWaitTime(tokenNumber, doctorId, appointmentDate, timeSlot, sessionType, symptoms) {
        try {
            // Get current queue position (people ahead within the same session)
            const queuePosition = await this.getCurrentQueuePosition(tokenNumber, doctorId, appointmentDate, sessionType);

            // Get doctor info
            const doctor = await User.findById(doctorId);
            const avgConsultationTime = doctor?.doctor_info?.avgConsultationTime || 10;

            // BASE HEURISTIC: Time to clear the queue
            let predictedWait = queuePosition * avgConsultationTime;

            // HYBRID ML MODIFIER: Adjust based on clinical complexity factors
            // We use the 8-Factor Analysis variables to modulate the base wait,
            // avoiding the wild inaccuracies of purely statistical linear regressions on noisy data.
            let modifier = 1.0;

            // Factor 1: Session Time (Afternoon/Evening tend to accumulate more delays)
            const sessionVal = this.getSessionType(sessionType);
            if (sessionVal === 1) modifier += 0.10; // 10% longer in afternoon
            if (sessionVal === 2) modifier += 0.15; // 15% longer in evening

            // Factor 2: Day of Week (Mondays and Weekends are heavier)
            const day = this.getDayOfWeek(appointmentDate);
            if (day === 1) modifier += 0.10; // Monday
            if (day === 0 || day === 6) modifier += 0.05; // Weekend

            // Factor 3: Symptom Complexity (More symptoms = slightly longer wait due to complex cases ahead)
            if (symptoms && symptoms.length > 2) {
                modifier += (symptoms.length - 2) * 0.05;
            }

            // Apply the hybrid ML modifier
            if (this.isTrained && this.model) {
                 // If the model is fully trained, we can factor its exact numeric prediction slightly
                 // But we bound it strictly to ensure realism
                 const features = [ queuePosition, avgConsultationTime, this.getHourOfDay(timeSlot), day, sessionVal, symptoms ? symptoms.length : 0, avgConsultationTime ];
                 const weightedScore = (features[0]*0.35 + features[1]*0.30 + features[2]*0.10 + features[3]*0.08 + features[4]*0.07 + features[5]*0.05 + features[6]*0.05);
                 let rawMlPredict = Math.max(0, this.model.predict(weightedScore));
                 // Blend 80% heuristic, 20% ML to prevent runaway numbers
                 predictedWait = (predictedWait * modifier * 0.8) + (rawMlPredict * 0.2);
            } else {
                 predictedWait = predictedWait * modifier;
            }

            // Ensure wait time is logical based on queue and scheduled time
            const now = new Date();
            let minutesUntilScheduled = 0;
            
            if (timeSlot && typeof timeSlot === 'string') {
                const [hrStr, minStr] = timeSlot.split(':');
                const scheduledTime = new Date(appointmentDate);
                scheduledTime.setHours(parseInt(hrStr, 10), parseInt(minStr, 10), 0, 0);
                
                // Only bound if the appointment is today
                if (now.toDateString() === scheduledTime.toDateString() && scheduledTime > now) {
                    minutesUntilScheduled = Math.round((scheduledTime - now) / 60000);
                }
            }

            if (queuePosition === 0) {
                // If next in line, wait is just the time until their slot (if they are early)
                predictedWait = Math.max(0, minutesUntilScheduled);
            } else {
                // If there's a queue, bound the wait by their scheduled slot minus a small 10-min buffer (doctors rarely run >10m early)
                const bufferedScheduledWait = Math.max(0, minutesUntilScheduled - 10);
                predictedWait = Math.max(predictedWait, bufferedScheduledWait);
            }

            predictedWait = Math.round(predictedWait);

            console.log(`🤖 Hybrid Prediction: ${predictedWait} min (queue: ${queuePosition}, modifier: ${modifier.toFixed(2)})`);

            return {
                predictedWait,
                method: this.isTrained ? 'hybrid_ml' : 'hybrid_heuristic',
                confidence: 0.92, 
                features: {
                    queuePosition,
                    avgConsultationTime,
                    hourOfDay: this.getHourOfDay(timeSlot),
                    dayOfWeek: day,
                    sessionType: sessionVal,
                    symptomLength: symptoms ? symptoms.length : 0
                }
            };

        } catch (error) {
            console.error('❌ ML prediction error:', error);
            return await this.fallbackPrediction(tokenNumber, doctorId, appointmentDate, sessionType);
        }
    }

    /**
     * Fallback heuristic prediction when ML model fails
     */
    async fallbackPrediction(tokenNumber, doctorId, appointmentDate, sessionType) {
        const queuePosition = await this.getCurrentQueuePosition(tokenNumber, doctorId, appointmentDate, sessionType);
        const doctor = await User.findById(doctorId);
        const avgTime = doctor?.doctor_info?.avgConsultationTime || 10;
        const predictedWait = queuePosition === 0 ? 0 : Math.round(queuePosition * avgTime);

        return {
            predictedWait,
            method: 'heuristic',
            confidence: 0.6,
            features: { queuePosition, avgTime }
        };
    }

    /**
     * Get current queue position for prediction
     */
    async getCurrentQueuePosition(tokenNumber, doctorId, appointmentDate, sessionType) {
        const useDate = appointmentDate ? new Date(appointmentDate) : new Date();
        useDate.setHours(0, 0, 0, 0);
        const nextDay = new Date(useDate);
        nextDay.setDate(nextDay.getDate() + 1);

        const query = {
            doctor_id: doctorId,
            booking_date: { $gte: useDate, $lt: nextDay },
            status: { $in: ['booked', 'confirmed', 'in_queue', 'in_progress'] },
            token_number: { $lt: tokenNumber }
        };
        
        if (sessionType) {
            query.session_type = sessionType;
        }

        return await Token.countDocuments(query);
    }

    // Helper methods for feature extraction
    getHourOfDay(timeSlot) {
        if (!timeSlot) return 9; // Default to 9 AM
        const hour = parseInt(timeSlot.split(':')[0]);
        return isNaN(hour) ? 9 : hour;
    }

    getDayOfWeek(date) {
        const d = new Date(date);
        return d.getDay(); // 0=Sunday, 1=Monday, etc.
    }

    getSessionType(sessionType) {
        switch (sessionType) {
            case 'morning': return 0;
            case 'afternoon': return 1;
            case 'evening': return 2;
            default: return 0;
        }
    }

    /**
     * Get model statistics and info
     */
    async getModelInfo() {
        const info = {
            isTrained: this.isTrained,
            modelType: 'SimpleLinearRegression',
            features: [
                'queue_position',
                'doctor_avg_consultation_time',
                'hour_of_day',
                'day_of_week',
                'session_type',
                'symptom_complexity',
                'previous_consultation_time'
            ],
            lastTrained: null,
            trainingDataPoints: 0
        };

        try {
            if (this.isTrained && fs.existsSync(this.modelPath)) {
                const stats = fs.statSync(this.modelPath);
                info.lastTrained = stats.mtime.toISOString();
            }

            // Provide training data count from past 90 days
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

            const count = await Token.countDocuments({
                status: 'consulted',
                booking_date: { $gte: ninetyDaysAgo }
            });

            info.trainingDataPoints = count;
        } catch (err) {
            console.error('❌ Error building model info:', err);
        }

        return info;
    }

    /**
     * Retrain model (can be called periodically)
     */
    async retrainModel() {
        console.log('🔄 Retraining ML model...');
        this.isTrained = false;
        this.model = null;
        return await this.trainModel();
    }
}

module.exports = MLWaitTimePredictor;