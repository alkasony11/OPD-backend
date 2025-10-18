const { Token, User } = require('../models/User');
const Notification = require('../models/Notification');
const { isSessionBookable, getSessionInfo } = require('../utils/bookingUtils');
const { transporter } = require('../config/email');

class AppointmentCancellationService {
  constructor() {
    this.isRunning = false;
  }

  // Check and cancel appointments that should be cancelled
  async checkAndCancelAppointments() {
    if (this.isRunning) {
      console.log('⏰ Cancellation check already running, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('🕐 Starting automatic appointment cancellation check...');

    try {
      const today = new Date();
      const todayString = today.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      console.log(`📅 Checking appointments for date: ${todayString}`);

      // Find all booked appointments for today that haven't been attended
      const todayAppointments = await Token.find({
        booking_date: todayString,
        status: 'booked'
      }).populate('patient_id', 'name email phone');

      console.log(`📊 Found ${todayAppointments.length} booked appointments for today`);

      let cancelledCount = 0;
      const currentTime = new Date();
      const currentTimeString = currentTime.toTimeString().slice(0, 5); // HH:MM format

      for (const appointment of todayAppointments) {
        const shouldCancel = this.shouldCancelAppointment(appointment, currentTimeString);
        
        if (shouldCancel) {
          await this.cancelAppointment(appointment);
          cancelledCount++;
        }
      }

      // Also check for appointments from previous days that are still booked
      const previousDaysCancelled = await this.cancelPreviousDaysAppointments();
      cancelledCount += previousDaysCancelled;

      console.log(`✅ Cancellation check completed. Cancelled ${cancelledCount} appointments (${cancelledCount - previousDaysCancelled} today, ${previousDaysCancelled} from previous days).`);

    } catch (error) {
      console.error('❌ Error in appointment cancellation check:', error);
    } finally {
      this.isRunning = false;
    }
  }

  // Cancel appointments from previous days that are still booked
  async cancelPreviousDaysAppointments() {
    try {
      const today = new Date();
      const todayString = today.toISOString().split('T')[0];

      // Find all booked appointments from previous days
      const previousAppointments = await Token.find({
        booking_date: { $lt: todayString },
        status: { $in: ['booked', 'in_queue'] }
      }).populate('patient_id', 'name email phone');

      console.log(`📅 Found ${previousAppointments.length} appointments from previous days that need cancellation`);

      let cancelledCount = 0;

      for (const appointment of previousAppointments) {
        console.log(`🚫 Cancelling previous day appointment: ${appointment._id} from ${appointment.booking_date}`);
        await this.cancelAppointment(appointment, 'No-show: Automatically cancelled - appointment date has passed');
        cancelledCount++;
      }

      return cancelledCount;

    } catch (error) {
      console.error('❌ Error cancelling previous days appointments:', error);
      return 0;
    }
  }

  // Determine if an appointment should be cancelled
  shouldCancelAppointment(appointment, currentTime) {
    const timeSlot = appointment.time_slot;
    if (!timeSlot) return false;

    // Get session info for the appointment time
    const sessionInfo = getSessionInfo(timeSlot);
    if (!sessionInfo) return false;

    console.log(`🔍 Checking appointment ${appointment._id}:`);
    console.log(`   Time slot: ${timeSlot}`);
    console.log(`   Session: ${sessionInfo.name}`);
    console.log(`   Current time: ${currentTime}`);

    // Check if we're past the session end time
    if (sessionInfo.type === 'morning') {
      // Morning session ends at 1 PM (13:00)
      const sessionEndTime = '13:00';
      const shouldCancel = currentTime >= sessionEndTime;
      console.log(`   Morning session end: ${sessionEndTime}, Should cancel: ${shouldCancel}`);
      return shouldCancel;
    } else if (sessionInfo.type === 'afternoon') {
      // Afternoon session ends at 6 PM (18:00)
      const sessionEndTime = '18:00';
      const shouldCancel = currentTime >= sessionEndTime;
      console.log(`   Afternoon session end: ${sessionEndTime}, Should cancel: ${shouldCancel}`);
      return shouldCancel;
    }

    return false;
  }

  // Cancel a specific appointment
  async cancelAppointment(appointment, customReason = null) {
    try {
      console.log(`🚫 Cancelling appointment ${appointment._id} for patient ${appointment.patient_id?.name}`);

      // Update appointment status to cancelled
      appointment.status = 'cancelled';
      appointment.cancellation_reason = customReason || 'No-show: Automatically cancelled after session end';
      appointment.cancelled_at = new Date();
      await appointment.save();

      // Create notification for the patient
      if (appointment.patient_id) {
        const notification = new Notification({
          user_id: appointment.patient_id._id,
          recipient_type: 'patient',
          recipient_id: appointment.patient_id._id,
          type: 'appointment_update',
          title: 'Appointment Cancelled',
          message: `Your appointment scheduled for ${appointment.booking_date} at ${appointment.time_slot} has been automatically cancelled due to no-show.`,
          appointment_id: appointment._id,
          is_read: false,
          created_at: new Date()
        });
        await notification.save();

        // Send email notification to patient
        await this.sendCancellationEmail(appointment, 'patient');
      }

      // Create notification for the doctor
      if (appointment.doctor_id) {
        const doctorNotification = new Notification({
          recipient_id: appointment.doctor_id,
          recipient_type: 'doctor',
          title: 'Appointment Auto-Cancelled',
          message: `Appointment with ${appointment.patient_id?.name || 'Patient'} scheduled for ${appointment.booking_date} at ${appointment.time_slot} was automatically cancelled due to no-show.`,
          type: 'cancellation',
          priority: 'normal',
          read: false,
          related_id: appointment._id,
          related_type: 'appointment'
        });
        await doctorNotification.save();

        // Send email notification to doctor
        await this.sendCancellationEmail(appointment, 'doctor');
      }

      console.log(`✅ Successfully cancelled appointment ${appointment._id}`);

    } catch (error) {
      console.error(`❌ Error cancelling appointment ${appointment._id}:`, error);
    }
  }

  // Send email notification for cancelled appointment
  async sendCancellationEmail(appointment, recipientType) {
    try {
      if (!transporter) {
        console.log('⚠️ Email service not configured, skipping email notification');
        return;
      }

      const patientName = appointment.patient_id?.name || 'Patient';
      const patientEmail = appointment.patient_id?.email;
      const doctorName = appointment.doctor_id?.name || 'Doctor';
      const doctorEmail = appointment.doctor_id?.email;
      
      const appointmentDate = new Date(appointment.booking_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      let emailData = {};

      if (recipientType === 'patient' && patientEmail) {
        emailData = {
          to: patientEmail,
          subject: 'Appointment Cancelled - OPD Management System',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
                <h2 style="color: #dc3545; margin-bottom: 20px;">Appointment Cancelled</h2>
                
                <p>Dear ${patientName},</p>
                
                <p>We regret to inform you that your appointment has been automatically cancelled due to no-show.</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <h3 style="color: #333; margin-top: 0;">Appointment Details:</h3>
                  <p><strong>Date:</strong> ${appointmentDate}</p>
                  <p><strong>Time:</strong> ${appointment.time_slot}</p>
                  <p><strong>Doctor:</strong> ${doctorName}</p>
                  <p><strong>Status:</strong> <span style="color: #dc3545;">Cancelled</span></p>
                  <p><strong>Reason:</strong> No-show (automatically cancelled)</p>
                </div>
                
                <p>If you need to reschedule your appointment, please contact our office or book a new appointment through our system.</p>
                
                <p>Thank you for your understanding.</p>
                
                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
                  <p style="color: #6c757d; font-size: 14px;">
                    This is an automated message from the OPD Management System.
                  </p>
                </div>
              </div>
            </div>
          `
        };
      } else if (recipientType === 'doctor' && doctorEmail) {
        emailData = {
          to: doctorEmail,
          subject: 'Appointment Auto-Cancelled - OPD Management System',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
                <h2 style="color: #dc3545; margin-bottom: 20px;">Appointment Auto-Cancelled</h2>
                
                <p>Dear Dr. ${doctorName},</p>
                
                <p>An appointment has been automatically cancelled due to patient no-show.</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <h3 style="color: #333; margin-top: 0;">Appointment Details:</h3>
                  <p><strong>Patient:</strong> ${patientName}</p>
                  <p><strong>Date:</strong> ${appointmentDate}</p>
                  <p><strong>Time:</strong> ${appointment.time_slot}</p>
                  <p><strong>Status:</strong> <span style="color: #dc3545;">Cancelled</span></p>
                  <p><strong>Reason:</strong> No-show (automatically cancelled)</p>
                </div>
                
                <p>This appointment has been automatically cancelled and removed from your schedule.</p>
                
                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
                  <p style="color: #6c757d; font-size: 14px;">
                    This is an automated message from the OPD Management System.
                  </p>
                </div>
              </div>
            </div>
          `
        };
      }

      if (emailData.to) {
        await transporter.sendMail(emailData);
        console.log(`📧 Cancellation email sent to ${recipientType}: ${emailData.to}`);
      } else {
        console.log(`⚠️ No email address found for ${recipientType}`);
      }

    } catch (error) {
      console.error(`❌ Error sending cancellation email to ${recipientType}:`, error);
    }
  }

  // Get statistics about today's cancellations
  async getCancellationStats() {
    try {
      const today = new Date();
      const todayString = today.toISOString().split('T')[0];

      // Simple approach: count cancelled appointments and categorize by time
      const cancelledAppointments = await Token.find({
        booking_date: todayString,
        status: 'cancelled',
        cancellation_reason: 'No-show: Automatically cancelled after session end'
      });

      let morningCancelled = 0;
      let afternoonCancelled = 0;

      cancelledAppointments.forEach(appointment => {
        const timeSlot = appointment.time_slot;
        if (timeSlot) {
          const time = parseInt(timeSlot.split(':')[0]);
          if (time >= 9 && time < 13) {
            morningCancelled++;
          } else if (time >= 14 && time < 18) {
            afternoonCancelled++;
          }
        }
      });

      return {
        totalCancelled: cancelledAppointments.length,
        morningCancelled,
        afternoonCancelled
      };

    } catch (error) {
      console.error('Error getting cancellation stats:', error);
      return {
        totalCancelled: 0,
        morningCancelled: 0,
        afternoonCancelled: 0
      };
    }
  }
}

// Create singleton instance
const appointmentCancellationService = new AppointmentCancellationService();

module.exports = appointmentCancellationService;
