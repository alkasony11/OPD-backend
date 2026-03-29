const { User, Token } = require('../models/User');
const emailService = require('./emailService');
const MLWaitTimePredictor = require('./mlWaitTimePredictor');

class QueueService {
    constructor() {
        this.mlPredictor = new MLWaitTimePredictor();
    }

    /**
     * Calculate predicted wait time for a specific token using ML
     * @param {string} tokenNumber - The token number to calculate wait for
     * @param {string} doctorId - The doctor's ID
     * @param {Date|string} [appointmentDate] - Optional date for which to calculate the queue (defaults to today)
     * @param {string} sessionType - The session type to calculate queue for
     * @returns {Promise<Object>} - { tokensAhead, avgConsultationTime, predictedWait, method, confidence }
     */
    static async calculateWaitTime(tokenNumber, doctorId, appointmentDate, sessionType) {
        try {
            // Get appointment details for ML features
            const appointment = await Token.findOne({ 
                token_number: tokenNumber, 
                doctor_id: doctorId,
                ...(sessionType ? { session_type: sessionType } : {})
            });
            
            if (!appointment) {
                return { tokensAhead: 0, avgConsultationTime: 10, predictedWait: 0, method: 'fallback', confidence: 0.5 };
            }

            // Fallback to appointment session type if not provided explicitly
            const activeSessionType = sessionType || appointment.session_type;

            // Use ML predictor for real ML-based prediction
            const mlPredictor = new MLWaitTimePredictor();
            const prediction = await mlPredictor.predictWaitTime(
                tokenNumber,
                doctorId,
                appointmentDate || appointment.booking_date,
                appointment.time_slot,
                activeSessionType,
                appointment.symptoms
            );

            // Also get basic queue stats for compatibility
            const queuePosition = await this.getCurrentQueuePosition(tokenNumber, doctorId, appointmentDate || appointment.booking_date, activeSessionType);
            const doctor = await User.findById(doctorId);
            const avgConsultationTime = doctor?.doctor_info?.avgConsultationTime || 10;

            return {
                tokensAhead: queuePosition,
                avgConsultationTime,
                predictedWait: prediction.predictedWait,
                method: prediction.method,
                confidence: prediction.confidence,
                features: prediction.features
            };

        } catch (error) {
            console.error('Wait time calculation error:', error);
            return { tokensAhead: 0, avgConsultationTime: 10, predictedWait: 0, method: 'error', confidence: 0 };
        }
    }

    /**     * Send email notifications to patients who are within the given wait threshold.
     * This is useful for alerting patients when their turn is approaching.
     * Runs every 5 minutes via cron job in cronService.js
     * @param {number} thresholdMinutes
     */
    static async notifyPatientsWithinWaitThreshold(thresholdMinutes = 30) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            // Find all active tokens for TODAY which haven't been notified yet
            const tokens = await Token.find({
                booking_date: { $gte: today, $lt: tomorrow },
                status: { $in: ['booked', 'confirmed', 'in_queue', 'in_progress'] },
                wait_notification_sent: { $ne: true }
            }).populate('doctor_id', 'name doctor_info');

            let notifiedCount = 0;

            for (const token of tokens) {
                try {
                    const prediction = await this.calculateWaitTime(token.token_number, token.doctor_id._id, token.booking_date, token.session_type);

                    // Only notify when the predicted wait is within the threshold window
                    if (prediction.predictedWait <= thresholdMinutes && prediction.predictedWait > 0) {
                        const patientEmail = token.patient_email || (token.patient_id ? (await User.findById(token.patient_id)).email : null);
                        if (!patientEmail) continue;

                        const patientName = token.patient_name || 'Patient';
                        const doctorName = token.doctor_id.name;
                        const department = token.department || 'General';
                        const tokenNumber = token.token_number;
                        const timeSlot = token.time_slot || '';
                        const waitMins = prediction.predictedWait;
                        const tokensAhead = prediction.tokensAhead;
                        const positionText = tokensAhead === 0 ? 'You are next' : `${tokensAhead} patient(s) ahead`;

                        const subject = `🏥 Your turn is approaching – ~${waitMins} min wait`;

                        const html = `
                        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
                          <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 20px 24px; color: white;">
                            <h2 style="margin: 0 0 4px 0; font-size: 18px;">🏥 MediQ Hospital</h2>
                            <p style="margin: 0; font-size: 13px; opacity: 0.9;">Your appointment is almost here</p>
                          </div>
                          <div style="padding: 24px;">
                            <p style="margin: 0 0 16px; font-size: 15px; color: #1f2937;">Hello <strong>${patientName}</strong>,</p>
                            
                            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 16px;">
                              <p style="margin: 0 0 6px 0; font-size: 14px; color: #92400e;">
                                ⏰ Your estimated wait is approximately <strong>${waitMins} minutes</strong>
                              </p>
                              <p style="margin: 0; font-size: 13px; font-weight: 600; color: #b45309;">
                                👥 Queue Status: ${positionText}
                              </p>
                            </div>

                            <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #374151;">
                              <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;"><strong>Doctor</strong></td>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; text-align: right;">Dr. ${doctorName}</td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;"><strong>Department</strong></td>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; text-align: right;">${department}</td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;"><strong>Token</strong></td>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; text-align: right;">#${tokenNumber}</td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0;"><strong>Time Slot</strong></td>
                                <td style="padding: 8px 0; text-align: right;">${timeSlot}</td>
                              </tr>
                            </table>

                            <p style="margin: 20px 0 0; font-size: 13px; color: #6b7280;">
                              Please be at the hospital and ready for your consultation. This is an automated notification based on the current queue status.
                            </p>
                          </div>
                          <div style="background: #f9fafb; padding: 12px 24px; text-align: center; font-size: 11px; color: #9ca3af;">
                            MediQ OPD • AI-Powered Queue Management
                          </div>
                        </div>`;

                        const message = `Hello ${patientName},\n\nYour appointment with Dr. ${doctorName} (${department}) is approximately ${waitMins} minutes away. (${positionText})\n\nToken: #${tokenNumber}\nTime Slot: ${timeSlot}\n\nPlease arrive on time.\n\nThank you,\nMediQ Hospital`;


                        await emailService.sendNotification(patientEmail, {
                            subject,
                            message,
                            html
                        });

                        // Mark this token as notified to avoid spamming
                        token.wait_notification_sent = true;
                        await token.save();
                        notifiedCount++;

                        console.log(`📩 Wait notification sent to ${patientName} (${patientEmail}) — ~${waitMins} min wait, Token #${tokenNumber}`);
                    }
                } catch (err) {
                    console.error('Error notifying patient about upcoming appointment:', err);
                }
            }

            if (notifiedCount > 0) {
                console.log(`✅ Wait-time notifications sent to ${notifiedCount} patient(s)`);
            }
        } catch (error) {
            console.error('Error in notifyPatientsWithinWaitThreshold:', error);
        }
    }

    /**
     * Get current queue position for prediction
     */
    static async getCurrentQueuePosition(tokenNumber, doctorId, appointmentDate, sessionType) {
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

    /**     * Get general queue stats for a doctor
     */
    static async getDoctorQueueStats(doctorId) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const doctor = await User.findById(doctorId);
            const avgTime = doctor?.doctor_info?.avgConsultationTime || 10;

            const totalWaiting = await Token.countDocuments({
                doctor_id: doctorId,
                booking_date: { $gte: today, $lt: tomorrow },
                status: { $in: ['booked', 'in_queue'] }
            });

            const inProgress = await Token.countDocuments({
                doctor_id: doctorId,
                booking_date: { $gte: today, $lt: tomorrow },
                status: 'in_progress'
            });

            return {
                totalWaiting,
                inProgress: inProgress > 0,
                avgWaitTime: avgTime,
                estimatedTotalQueueTime: (totalWaiting * avgTime)
            };
        } catch (error) {
            return null;
        }
    }
}

module.exports = QueueService;
