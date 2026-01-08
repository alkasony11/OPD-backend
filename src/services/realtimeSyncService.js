const Token = require('../models/User');
const DoctorSchedule = require('../models/DoctorSchedule');
const LeaveRequest = require('../models/LeaveRequest');
const Department = require('../models/Department');

class RealtimeSyncService {
  constructor(io) {
    this.io = io;
  }

  // Emit schedule changes to all connected clients
  async emitScheduleChange(doctorId, date, changeType, data) {
    try {
      const eventData = {
        doctorId,
        date,
        changeType, // 'created', 'updated', 'deleted'
        data,
        timestamp: new Date()
      };

      // Notify all clients about schedule changes
      this.io.emit('schedule-changed', eventData);
      
      // Notify patient clients specifically about availability changes
      this.io.to('patient').emit('availability-changed', {
        doctorId,
        date,
        available: changeType !== 'deleted',
        data
      });

      console.log(`📡 Schedule change broadcasted: ${changeType} for doctor ${doctorId} on ${date}`);
    } catch (error) {
      console.error('Error emitting schedule change:', error);
    }
  }

  // Emit department status changes
  async emitDepartmentStatusChange(departmentId, isActive, departmentName) {
    try {
      const eventData = {
        departmentId,
        isActive,
        departmentName,
        timestamp: new Date()
      };

      // Notify all clients about department status changes
      this.io.emit('department-status-changed', eventData);
      
      // Notify patient clients about booking availability
      this.io.to('patient').emit('department-availability-changed', {
        departmentId,
        available: isActive,
        departmentName
      });

      console.log(`📡 Department status broadcasted: ${departmentName} is now ${isActive ? 'active' : 'inactive'}`);
    } catch (error) {
      console.error('Error emitting department status change:', error);
    }
  }

  // Emit leave request approval and handle appointment cancellations
  async emitLeaveApproval(leaveRequest, affectedAppointments = []) {
    try {
      const eventData = {
        leaveRequestId: leaveRequest._id,
        doctorId: leaveRequest.doctor_id,
        startDate: leaveRequest.start_date,
        endDate: leaveRequest.end_date,
        reason: leaveRequest.reason,
        affectedAppointments,
        timestamp: new Date()
      };

      // Notify all clients about leave approval
      this.io.emit('leave-approved', eventData);
      
      // Notify patient clients about cancelled appointments
      if (affectedAppointments.length > 0) {
        this.io.to('patient').emit('appointments-cancelled', {
          appointments: affectedAppointments,
          reason: `Doctor on leave: ${leaveRequest.reason}`,
          timestamp: new Date()
        });
      }

      console.log(`📡 Leave approval broadcasted: ${affectedAppointments.length} appointments affected`);
    } catch (error) {
      console.error('Error emitting leave approval:', error);
    }
  }

  // Emit appointment status changes
  async emitAppointmentStatusChange(appointmentId, oldStatus, newStatus, patientId) {
    try {
      const eventData = {
        appointmentId,
        oldStatus,
        newStatus,
        patientId,
        timestamp: new Date()
      };

      // Notify all clients about appointment status changes
      this.io.emit('appointment-status-changed', eventData);
      
      // Notify specific patient if they're connected
      this.io.to(`patient-${patientId}`).emit('your-appointment-updated', {
        appointmentId,
        newStatus,
        timestamp: new Date()
      });

      console.log(`📡 Appointment status broadcasted: ${appointmentId} changed from ${oldStatus} to ${newStatus}`);
    } catch (error) {
      console.error('Error emitting appointment status change:', error);
    }
  }

  // Get affected appointments when leave is approved
  async getAffectedAppointments(doctorId, startDate, endDate) {
    try {
      const affectedAppointments = await Token.find({
        doctor_id: doctorId,
        booking_date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        },
        status: { $in: ['booked', 'in_queue', 'confirmed'] }
      }).populate('patient_id', 'name email phone');

      return affectedAppointments;
    } catch (error) {
      console.error('Error getting affected appointments:', error);
      return [];
    }
  }

  // Cancel affected appointments when leave is approved
  async cancelAffectedAppointments(doctorId, startDate, endDate, reason) {
    try {
      const result = await Token.updateMany(
        {
          doctor_id: doctorId,
          booking_date: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          },
          status: { $in: ['booked', 'in_queue', 'confirmed'] }
        },
        {
          $set: {
            status: 'cancelled_by_hospital',
            cancellation_reason: reason,
            cancelled_at: new Date(),
            cancelled_by: 'system'
          }
        }
      );

      console.log(`📡 Cancelled ${result.modifiedCount} appointments due to leave approval`);
      return result.modifiedCount;
    } catch (error) {
      console.error('Error cancelling affected appointments:', error);
      return 0;
    }
  }

  // Emit real-time queue updates
  async emitQueueUpdate(doctorId, queueData) {
    try {
      const eventData = {
        doctorId,
        queueData,
        timestamp: new Date()
      };

      // Notify admin and doctor clients about queue updates
      this.io.to('admin').emit('queue-updated', eventData);
      this.io.to('doctor').emit('queue-updated', eventData);
      this.io.to(`doctor-${doctorId}`).emit('your-queue-updated', eventData);

      console.log(`📡 Queue update broadcasted for doctor ${doctorId}`);
    } catch (error) {
      console.error('Error emitting queue update:', error);
    }
  }

  // Emit real-time appointment updates
  async emitAppointmentUpdate(doctorId, appointmentData) {
    try {
      const eventData = {
        doctorId,
        appointmentData,
        timestamp: new Date()
      };

      // Notify admin and doctor clients about appointment updates
      this.io.to('admin').emit('appointment-status-changed', eventData);
      this.io.to('doctor').emit('appointment-status-changed', eventData);
      this.io.to(`doctor-${doctorId}`).emit('your-appointment-updated', eventData);

      // If this is a doctor join video event, notify the specific patient
      if (appointmentData.type === 'doctor_joined_video' && appointmentData.patientId) {
        this.io.to(`patient-${appointmentData.patientId}`).emit('your-appointment-updated', {
          type: 'doctor_joined_video',
          message: appointmentData.message,
          meetingUrl: appointmentData.meetingUrl,
          appointmentId: appointmentData.appointmentId,
          timestamp: new Date()
        });
      }

      console.log(`📡 Appointment update broadcasted for doctor ${doctorId}:`, appointmentData);
    } catch (error) {
      console.error('Error emitting appointment update:', error);
    }
  }

  // Emit system alerts
  async emitSystemAlert(alertType, message, severity = 'info', data = {}) {
    try {
      const eventData = {
        alertType,
        message,
        severity,
        data,
        timestamp: new Date()
      };

      // Notify admin clients about system alerts
      this.io.to('admin').emit('system-alert', eventData);

      console.log(`📡 System alert broadcasted: ${alertType} - ${message}`);
    } catch (error) {
      console.error('Error emitting system alert:', error);
    }
  }
}

module.exports = RealtimeSyncService;
