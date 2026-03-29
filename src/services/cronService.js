const cron = require('node-cron');
const appointmentCancellationService = require('./appointmentCancellationService');
const QueueService = require('./queueService');

class CronService {
  constructor() {
    this.jobs = [];
    this.isRunning = false;
  }

  // Start all scheduled jobs
  start() {
    if (this.isRunning) {
      console.log('⏰ Cron service already running');
      return;
    }

    console.log('🚀 Starting cron service...');

    // Job 1: Check for morning session cancellations at 1:05 PM (13:05)
    // This runs after morning session ends at 1:00 PM
    const morningCancellationJob = cron.schedule('5 13 * * *', async () => {
      console.log('🕐 Running morning session cancellation check...');
      await appointmentCancellationService.checkAndCancelAppointments();
    }, {
      scheduled: true,
      timezone: 'Asia/Kolkata' // Adjust timezone as needed
    });

    // Job 2: Check for afternoon session cancellations at 6:05 PM (18:05)
    // This runs after afternoon session ends at 6:00 PM
    const afternoonCancellationJob = cron.schedule('5 18 * * *', async () => {
      console.log('🕐 Running afternoon session cancellation check...');
      await appointmentCancellationService.checkAndCancelAppointments();
    }, {
      scheduled: true,
      timezone: 'Asia/Kolkata' // Adjust timezone as needed
    });

    // Job 3: Hourly cleanup for previous days appointments
    const hourlyCleanupJob = cron.schedule('0 * * * *', async () => {
      console.log('🧹 Running hourly cleanup for previous days appointments...');
      await appointmentCancellationService.cancelPreviousDaysAppointments();
    }, {
      scheduled: true,
      timezone: 'Asia/Kolkata'
    });

    // Job 4: Notify patients who are about to be called (within 30 minutes)
    const waitNotificationJob = cron.schedule('*/5 * * * *', async () => {
      console.log('📩 Running wait-time notification job...');
      await QueueService.notifyPatientsWithinWaitThreshold(30);
    }, {
      scheduled: true,
      timezone: 'Asia/Kolkata'
    });

    // Job 5: Daily cleanup and stats at 11:59 PM
    const dailyCleanupJob = cron.schedule('59 23 * * *', async () => {
      console.log('🧹 Running daily cleanup...');
      const stats = await appointmentCancellationService.getCancellationStats();
      console.log('📊 Daily cancellation stats:', stats);
    }, {
      scheduled: true,
      timezone: 'Asia/Kolkata'
    });

    // Store job references
    this.jobs = [
      { name: 'morning-cancellation', job: morningCancellationJob },
      { name: 'afternoon-cancellation', job: afternoonCancellationJob },
      { name: 'hourly-cleanup', job: hourlyCleanupJob },
      { name: 'wait-notification', job: waitNotificationJob },
      { name: 'daily-cleanup', job: dailyCleanupJob }
    ];

    this.isRunning = true;
    console.log('✅ Cron service started successfully');
    console.log('📅 Scheduled jobs:');
    console.log('   - Morning cancellation check: 1:05 PM daily');
    console.log('   - Afternoon cancellation check: 6:05 PM daily');
    console.log('   - Wait-time notification (every 5 minutes)');
    console.log('   - Daily cleanup: 11:59 PM daily');
  }

  // Stop all scheduled jobs
  stop() {
    if (!this.isRunning) {
      console.log('⏰ Cron service not running');
      return;
    }

    console.log('🛑 Stopping cron service...');
    
    this.jobs.forEach(({ name, job }) => {
      job.destroy();
      console.log(`   - Stopped job: ${name}`);
    });

    this.jobs = [];
    this.isRunning = false;
    console.log('✅ Cron service stopped');
  }

  // Get status of all jobs
  getStatus() {
    return {
      isRunning: this.isRunning,
      jobs: this.jobs.map(({ name, job }) => ({
        name,
        running: job.running
      }))
    };
  }

  // Manually trigger cancellation check (for testing)
  async triggerCancellationCheck() {
    console.log('🔧 Manually triggering cancellation check...');
    await appointmentCancellationService.checkAndCancelAppointments();
  }

  // Get cancellation statistics
  async getCancellationStats() {
    return await appointmentCancellationService.getCancellationStats();
  }
}

// Create singleton instance
const cronService = new CronService();

module.exports = cronService;
