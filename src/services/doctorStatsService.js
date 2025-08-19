const { Token, User } = require('../models/User');
const DoctorSchedule = require('../models/DoctorSchedule');
const DoctorStats = require('../models/DoctorStats');

class DoctorStatsService {
  
  // Calculate comprehensive stats for a doctor
  static async calculateStats(doctorId) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);

      // Parallel queries for better performance
      const [
        todayStats,
        monthStats,
        totalStats,
        scheduleStats,
        uniquePatients
      ] = await Promise.all([
        // Today's stats
        this.getTodayStats(doctorId, today, tomorrow),
        
        // Month stats
        this.getMonthStats(doctorId, startOfMonth, endOfMonth),
        
        // Total stats
        this.getTotalStats(doctorId),
        
        // Schedule stats for this month
        this.getScheduleStats(doctorId, startOfMonth, endOfMonth),
        
        // Unique patients count
        Token.distinct('patient_id', { doctor_id: doctorId })
      ]);

      const statsData = {
        doctor_id: doctorId,
        
        // Today's stats
        today_appointments: todayStats.total,
        today_completed: todayStats.completed,
        today_cancelled: todayStats.cancelled,
        today_pending: todayStats.pending,
        
        // Month stats
        month_appointments: monthStats.total,
        month_completed: monthStats.completed,
        month_revenue: monthStats.revenue,
        
        // Total stats
        total_patients: uniquePatients.length,
        total_appointments: totalStats.total,
        total_completed: totalStats.completed,
        
        // Schedule stats
        working_days_this_month: scheduleStats.workingDays,
        leave_days_this_month: scheduleStats.leaveDays,
        
        // Update timestamps
        last_calculated: new Date(),
        cache_expires_at: new Date(Date.now() + 60 * 60 * 1000) // 1 hour cache
      };

      // Update or create stats document
      const stats = await DoctorStats.findOneAndUpdate(
        { doctor_id: doctorId },
        statsData,
        { upsert: true, new: true }
      );

      return stats;
    } catch (error) {
      console.error('Error calculating doctor stats:', error);
      throw error;
    }
  }

  // Get today's appointment statistics
  static async getTodayStats(doctorId, today, tomorrow) {
    const todayAppointments = await Token.aggregate([
      {
        $match: {
          doctor_id: doctorId,
          booking_date: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const stats = {
      total: 0,
      completed: 0,
      cancelled: 0,
      pending: 0
    };

    todayAppointments.forEach(stat => {
      stats.total += stat.count;
      if (stat._id === 'consulted') stats.completed = stat.count;
      if (stat._id === 'cancelled') stats.cancelled = stat.count;
      if (['booked', 'in_queue'].includes(stat._id)) stats.pending += stat.count;
    });

    return stats;
  }

  // Get month's appointment statistics
  static async getMonthStats(doctorId, startOfMonth, endOfMonth) {
    const monthAppointments = await Token.aggregate([
      {
        $match: {
          doctor_id: doctorId,
          booking_date: { $gte: startOfMonth, $lte: endOfMonth }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get doctor's consultation fee for revenue calculation
    const doctor = await User.findById(doctorId);
    const consultationFee = doctor?.doctor_info?.consultation_fee || 500;

    const stats = {
      total: 0,
      completed: 0,
      revenue: 0
    };

    monthAppointments.forEach(stat => {
      stats.total += stat.count;
      if (stat._id === 'consulted') {
        stats.completed = stat.count;
        stats.revenue = stat.count * consultationFee;
      }
    });

    return stats;
  }

  // Get total appointment statistics
  static async getTotalStats(doctorId) {
    const totalAppointments = await Token.aggregate([
      {
        $match: { doctor_id: doctorId }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const stats = {
      total: 0,
      completed: 0
    };

    totalAppointments.forEach(stat => {
      stats.total += stat.count;
      if (stat._id === 'consulted') stats.completed = stat.count;
    });

    return stats;
  }

  // Get schedule statistics for the month
  static async getScheduleStats(doctorId, startOfMonth, endOfMonth) {
    const schedules = await DoctorSchedule.find({
      doctor_id: doctorId,
      date: { $gte: startOfMonth, $lte: endOfMonth }
    });

    const stats = {
      workingDays: 0,
      leaveDays: 0
    };

    schedules.forEach(schedule => {
      if (schedule.is_available) {
        stats.workingDays++;
      } else {
        stats.leaveDays++;
      }
    });

    return stats;
  }

  // Get cached stats or calculate if expired
  static async getStats(doctorId) {
    try {
      let stats = await DoctorStats.findOne({ doctor_id: doctorId });
      
      if (!stats || stats.needsRefresh()) {
        console.log(`Calculating fresh stats for doctor ${doctorId}`);
        stats = await this.calculateStats(doctorId);
      }
      
      return stats;
    } catch (error) {
      console.error('Error getting doctor stats:', error);
      throw error;
    }
  }

  // Force refresh stats (bypass cache)
  static async refreshStats(doctorId) {
    return await this.calculateStats(doctorId);
  }

  // Get appointment trends for the last 30 days
  static async getAppointmentTrends(doctorId, days = 30) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const trends = await Token.aggregate([
        {
          $match: {
            doctor_id: doctorId,
            booking_date: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$booking_date" } },
              status: "$status"
            },
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: "$_id.date",
            appointments: {
              $push: {
                status: "$_id.status",
                count: "$count"
              }
            },
            total: { $sum: "$count" }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]);

      return trends;
    } catch (error) {
      console.error('Error getting appointment trends:', error);
      throw error;
    }
  }

  // Get patient demographics
  static async getPatientDemographics(doctorId) {
    try {
      const demographics = await Token.aggregate([
        {
          $match: { doctor_id: doctorId }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'patient_id',
            foreignField: '_id',
            as: 'patient'
          }
        },
        {
          $unwind: '$patient'
        },
        {
          $group: {
            _id: '$patient.gender',
            count: { $sum: 1 }
          }
        }
      ]);

      return demographics;
    } catch (error) {
      console.error('Error getting patient demographics:', error);
      throw error;
    }
  }
}

module.exports = DoctorStatsService;