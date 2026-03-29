/**
 * Queue Priority and Management Service
 * Integrates ML wait time predictions with real-time queue management
 */

const MLWaitTimePredictionService = require('./mlWaitTimePredictionService');

class QueuePriorityManagementService {
  constructor() {
    this.mlService = new MLWaitTimePredictionService();
    this.activeQueues = new Map(); // Store multiple doctor queues
    this.priorityScores = new Map(); // Store priority calculations
  }

  /**
   * Add patient to queue with ML-based priority
   */
  async addToQueue(patientData, appointmentData, doctorId, departmentName) {
    try {
      // Calculate priority score
      const priorityScore = this.mlService.calculateQueuePriority({
        symptoms: appointmentData.symptoms,
        age: patientData.age,
        appointmentType: appointmentData.appointmentType,
        departmentName: departmentName,
        hasComorbidities: patientData.hasComorbidities,
        previousNoShows: patientData.previousNoShows || 0,
      });

      // Predict wait time
      const waitTimePrediction = await this.mlService.predictWaitTime({
        appointmentTime: appointmentData.appointmentTime,
        appointmentType: appointmentData.appointmentType,
        departmentName: departmentName,
        doctorId: doctorId,
        symptoms: appointmentData.symptoms,
        patientAge: patientData.age,
        currentQueueLength: this.getQueueLength(doctorId),
      });

      // Create queue entry
      const queueEntry = {
        patientId: patientData._id,
        patientName: patientData.name,
        department: departmentName,
        doctor: doctorId,
        appointmentType: appointmentData.appointmentType,
        symptoms: appointmentData.symptoms,
        priorityScore: priorityScore,
        predictedWaitTime: waitTimePrediction.predictedWaitTime,
        confidence: waitTimePrediction.confidence,
        addedAt: new Date(),
        status: 'waiting',
        tokenNumber: null,
      };

      // Store in active queues
      if (!this.activeQueues.has(doctorId)) {
        this.activeQueues.set(doctorId, []);
      }

      const queue = this.activeQueues.get(doctorId);
      queue.push(queueEntry);

      // Sort by priority (highest first)
      queue.sort((a, b) => b.priorityScore - a.priorityScore);

      // Assign token numbers
      this.assignTokenNumbers(doctorId);

      return {
        success: true,
        queueEntry: queueEntry,
        position: queue.findIndex(p => p.patientId === patientData._id) + 1,
        totalInQueue: queue.length,
        estimatedWait: waitTimePrediction.predictedWaitTime,
        message: `Added to queue. Position: ${queue.findIndex(p => p.patientId === patientData._id) + 1} of ${queue.length}. Estimated wait: ${waitTimePrediction.predictedWaitTime} minutes`,
      };
    } catch (error) {
      console.error('Error adding to queue:', error);
      throw new Error('Failed to add patient to queue');
    }
  }

  /**
   * Get current queue for a doctor with ML predictions
   */
  getQueueWithPredictions(doctorId) {
    const queue = this.activeQueues.get(doctorId) || [];

    return queue.map((patient, index) => ({
      position: index + 1,
      patientId: patient.patientId,
      patientName: patient.patientName,
      priorityScore: patient.priorityScore,
      predictedWaitTime: patient.predictedWaitTime,
      symptoms: patient.symptoms,
      appointmentType: patient.appointmentType,
      status: patient.status,
      tokenNumber: patient.tokenNumber,
      servedBy: patient.servedBy || null,
      servedTime: patient.servedTime || null,
    }));
  }

  /**
   * Get queue analytics and insights
   */
  getQueueAnalytics(doctorId) {
    const queue = this.activeQueues.get(doctorId) || [];

    if (queue.length === 0) {
      return {
        totalPatients: 0,
        avgPriority: 0,
        avgWaitTime: 0,
        urgentCases: 0,
        estimatedEndTime: null,
      };
    }

    const urgentCases = queue.filter(p => p.priorityScore > 75).length;
    const avgPriority = (queue.reduce((sum, p) => sum + p.priorityScore, 0) / queue.length).toFixed(1);
    const avgWaitTime = (queue.reduce((sum, p) => sum + p.predictedWaitTime, 0) / queue.length).toFixed(0);

    // Estimate end time
    const totalMinutes = queue.reduce((sum, p) => sum + p.predictedWaitTime, 0);
    const estimatedEndTime = new Date(Date.now() + totalMinutes * 60 * 1000);

    return {
      totalPatients: queue.length,
      avgPriority: parseFloat(avgPriority),
      avgWaitTime: parseInt(avgWaitTime),
      urgentCases: urgentCases,
      estimatedEndTime: estimatedEndTime,
      highPriorityCount: queue.filter(p => p.priorityScore > 60).length,
      normalPriorityCount: queue.filter(p => p.priorityScore <= 60).length,
    };
  }

  /**
   * Update patient status in queue
   */
  updatePatientStatus(doctorId, patientId, newStatus) {
    const queue = this.activeQueues.get(doctorId);
    if (!queue) return null;

    const patient = queue.find(p => p.patientId === patientId);
    if (!patient) return null;

    patient.status = newStatus;
    if (newStatus === 'completed') {
      patient.servedTime = new Date();
    }

    return patient;
  }

  /**
   * Mark patient as called/being served
   */
  callPatient(doctorId, patientId) {
    const queue = this.activeQueues.get(doctorId);
    if (!queue) return null;

    const patient = queue.find(p => p.patientId === patientId);
    if (!patient) return null;

    patient.status = 'being_served';
    patient.servedBy = doctorId;
    patient.servedTime = new Date();

    return patient;
  }

  /**
   * Remove patient from queue (completed or no-show)
   */
  removeFromQueue(doctorId, patientId, reason = 'completed') {
    const queue = this.activeQueues.get(doctorId);
    if (!queue) return null;

    const index = queue.findIndex(p => p.patientId === patientId);
    if (index === -1) return null;

    const patient = queue.splice(index, 1)[0];
    patient.status = reason;
    patient.leftAt = new Date();

    // Re-assign token numbers
    this.assignTokenNumbers(doctorId);

    return patient;
  }

  /**
   * Assign token numbers to queue
   */
  assignTokenNumbers(doctorId) {
    const queue = this.activeQueues.get(doctorId);
    if (!queue) return;

    queue.forEach((patient, index) => {
      patient.tokenNumber = `T${(index + 1).toString().padStart(3, '0')}`;
    });
  }

  /**
   * Get queue length for a doctor
   */
  getQueueLength(doctorId) {
    const queue = this.activeQueues.get(doctorId);
    return queue ? queue.length : 0;
  }

  /**
   * Get next patient to be called (highest priority)
   */
  getNextPatient(doctorId) {
    const queue = this.activeQueues.get(doctorId);
    if (!queue || queue.length === 0) return null;

    // Return first patient (already sorted by priority)
    return queue[0];
  }

  /**
   * Re-prioritize queue based on new information
   */
  async reprioritizeQueue(doctorId, departmentName) {
    const queue = this.activeQueues.get(doctorId);
    if (!queue) return null;

    // Recalculate priorities for all patients
    for (const patient of queue) {
      const newPriority = this.mlService.calculateQueuePriority({
        symptoms: patient.symptoms,
        appointmentType: patient.appointmentType,
        departmentName: departmentName,
      });

      patient.priorityScore = newPriority;
    }

    // Re-sort by priority
    queue.sort((a, b) => b.priorityScore - a.priorityScore);

    // Re-assign token numbers
    this.assignTokenNumbers(doctorId);

    return {
      message: 'Queue reprioritized',
      queue: this.getQueueWithPredictions(doctorId),
    };
  }

  /**
   * Get queue statistics for reporting
   */
  getQueueStatistics(doctorId) {
    const queue = this.activeQueues.get(doctorId) || [];

    const completed = queue.filter(p => p.status === 'completed');
    const noShows = queue.filter(p => p.status === 'no_show');
    const waiting = queue.filter(p => p.status === 'waiting');

    const avgServeTime = completed.length > 0
      ? completed.reduce((sum, p) => sum + (p.servedTime - p.addedAt), 0) / completed.length / 60000
      : 0;

    return {
      date: new Date(),
      doctorId: doctorId,
      totalSeen: completed.length,
      averageServeTime: avgServeTime.toFixed(1),
      noShowRate: completed.length > 0 ? ((noShows.length / (completed.length + noShows.length)) * 100).toFixed(1) : 0,
      currentQueue: waiting.length,
      peakHour: this.determinePeakHour(completed),
      urgentCasesPrioritized: queue.filter(p => p.priorityScore > 75).length,
    };
  }

  /**
   * Determine peak hour
   */
  determinePeakHour(completedPatients) {
    const hours = {};
    completedPatients.forEach(p => {
      const hour = new Date(p.addedAt).getHours();
      hours[hour] = (hours[hour] || 0) + 1;
    });

    let peakHour = 0;
    let maxCount = 0;
    Object.entries(hours).forEach(([hour, count]) => {
      if (count > maxCount) {
        maxCount = count;
        peakHour = parseInt(hour);
      }
    });

    return peakHour;
  }

  /**
   * Send real-time updates to patients (via WebSocket)
   */
  getQueueUpdateForPatient(doctorId, patientId) {
    const queue = this.activeQueues.get(doctorId);
    if (!queue) return null;

    const patientIndex = queue.findIndex(p => p.patientId === patientId);
    if (patientIndex === -1) return null;

    const patient = queue[patientIndex];
    const patientsAhead = patientIndex;

    // Recalculate wait time based on current queue
    const remainingWaitTime = queue
      .slice(0, patientIndex)
      .reduce((sum, p) => sum + p.predictedWaitTime, 0);

    return {
      patientId: patientId,
      position: patientIndex + 1,
      patientsAhead: patientsAhead,
      estimatedWaitTime: remainingWaitTime,
      tokenNumber: patient.tokenNumber,
      status: patient.status,
      message: `You are ${patientIndex + 1}${this.getOrdinalSuffix(patientIndex + 1)} in queue. Estimated wait: ${remainingWaitTime} minutes.`,
      lastUpdated: new Date(),
    };
  }

  /**
   * Get ordinal suffix (1st, 2nd, 3rd, etc.)
   */
  getOrdinalSuffix(num) {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
  }

  /**
   * Clear completed patients from queue (cleanup)
   */
  cleanupQueue(doctorId) {
    const queue = this.activeQueues.get(doctorId);
    if (!queue) return 0;

    const initialLength = queue.length;
    const updatedQueue = queue.filter(p => p.status === 'waiting' || p.status === 'being_served');
    this.activeQueues.set(doctorId, updatedQueue);

    return initialLength - updatedQueue.length;
  }
}

module.exports = QueuePriorityManagementService;
