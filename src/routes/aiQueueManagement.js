/**
 * AI Queue Management API Routes
 * Endpoints for ML-based wait time prediction and queue priority management
 */

const express = require('express');
const router = express.Router();
const MLWaitTimePredictionService = require('../services/mlWaitTimePredictionService');
const QueuePriorityManagementService = require('../services/queuePriorityManagementService');
const { User } = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

// Initialize services
const mlService = new MLWaitTimePredictionService();
const queueService = new QueuePriorityManagementService();

/**
 * Predict wait time for an appointment
 * POST /api/queue/predict-wait-time
 */
router.post('/predict-wait-time', authMiddleware, async (req, res) => {
  try {
    const {
      appointmentTime,
      appointmentType,
      departmentName,
      doctorId,
      symptoms,
      patientAge,
      currentQueueLength,
    } = req.body;

    // Validate required fields
    if (!appointmentTime || !departmentName || !doctorId) {
      return res.status(400).json({
        error: 'Missing required fields: appointmentTime, departmentName, doctorId',
      });
    }

    // Get prediction
    const prediction = await mlService.predictWaitTime({
      appointmentTime,
      appointmentType: appointmentType || 'regular',
      departmentName,
      doctorId,
      symptoms: symptoms || '',
      patientAge: patientAge || 30,
      currentQueueLength: currentQueueLength || 0,
    });

    res.json({
      success: true,
      prediction: {
        estimatedWaitTime: prediction.predictedWaitTime,
        confidence: (prediction.confidence * 100).toFixed(1) + '%',
        factors: prediction.factors,
        breakdown: prediction.breakdown,
      },
      message: `Estimated wait time: ${prediction.predictedWaitTime} minutes (${(prediction.confidence * 100).toFixed(1)}% confidence)`,
    });
  } catch (error) {
    console.error('Wait time prediction error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Calculate queue priority for a patient
 * POST /api/queue/calculate-priority
 */
router.post('/calculate-priority', authMiddleware, async (req, res) => {
  try {
    const {
      symptoms,
      age,
      appointmentType,
      departmentName,
      hasComorbidities,
      previousNoShows,
    } = req.body;

    const priorityScore = mlService.calculateQueuePriority({
      symptoms: symptoms || '',
      age: age || 30,
      appointmentType: appointmentType || 'regular',
      departmentName: departmentName || 'General Medicine',
      hasComorbidities: hasComorbidities || false,
      previousNoShows: previousNoShows || 0,
    });

    // Determine priority level
    let priorityLevel = 'Normal';
    if (priorityScore >= 75) priorityLevel = 'Urgent';
    else if (priorityScore >= 60) priorityLevel = 'High';
    else if (priorityScore >= 40) priorityLevel = 'Normal';
    else priorityLevel = 'Low';

    res.json({
      success: true,
      priorityScore: priorityScore.toFixed(1),
      priorityLevel: priorityLevel,
      color: priorityLevel === 'Urgent' ? '#ff4444' : priorityLevel === 'High' ? '#ff8800' : '#44aa44',
    });
  } catch (error) {
    console.error('Priority calculation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add patient to queue with ML-based prioritization
 * POST /api/queue/add-patient
 */
router.post('/add-patient', authMiddleware, async (req, res) => {
  try {
    const {
      patientId,
      patientName,
      age,
      doctorId,
      departmentName,
      appointmentType,
      symptoms,
      hasComorbidities,
      appointmentTime,
    } = req.body;

    if (!patientId || !doctorId || !departmentName) {
      return res.status(400).json({
        error: 'Missing required fields: patientId, doctorId, departmentName',
      });
    }

    const result = await queueService.addToQueue(
      {
        _id: patientId,
        name: patientName,
        age: age || 30,
        hasComorbidities: hasComorbidities || false,
        previousNoShows: 0,
      },
      {
        symptoms: symptoms || '',
        appointmentType: appointmentType || 'regular',
        appointmentTime: appointmentTime || new Date(),
      },
      doctorId,
      departmentName
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Add to queue error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get current queue for a doctor
 * GET /api/queue/:doctorId
 */
router.get('/:doctorId', authMiddleware, (req, res) => {
  try {
    const { doctorId } = req.params;

    const queue = queueService.getQueueWithPredictions(doctorId);
    const analytics = queueService.getQueueAnalytics(doctorId);

    res.json({
      success: true,
      doctorId,
      queue,
      analytics,
      lastUpdated: new Date(),
    });
  } catch (error) {
    console.error('Get queue error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get queue analytics and statistics
 * GET /api/queue/analytics/:doctorId
 */
router.get('/analytics/:doctorId', authMiddleware, (req, res) => {
  try {
    const { doctorId } = req.params;

    const analytics = queueService.getQueueAnalytics(doctorId);
    const statistics = queueService.getQueueStatistics(doctorId);

    res.json({
      success: true,
      analytics,
      statistics,
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get real-time queue update for patient
 * GET /api/queue/:doctorId/patient/:patientId
 */
router.get('/:doctorId/patient/:patientId', authMiddleware, (req, res) => {
  try {
    const { doctorId, patientId } = req.params;

    const queueUpdate = queueService.getQueueUpdateForPatient(doctorId, patientId);

    if (!queueUpdate) {
      return res.status(404).json({
        error: 'Patient not found in queue',
      });
    }

    res.json({
      success: true,
      queueUpdate,
    });
  } catch (error) {
    console.error('Get patient queue update error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Call next patient in queue
 * POST /api/queue/:doctorId/call-next
 */
router.post('/:doctorId/call-next', authMiddleware, (req, res) => {
  try {
    const { doctorId } = req.params;

    const nextPatient = queueService.getNextPatient(doctorId);

    if (!nextPatient) {
      return res.status(200).json({
        success: true,
        message: 'No patients in queue',
        nextPatient: null,
      });
    }

    // Mark as being served
    queueService.callPatient(doctorId, nextPatient.patientId);

    res.json({
      success: true,
      message: `Calling patient: ${nextPatient.patientName}`,
      nextPatient: {
        patientId: nextPatient.patientId,
        patientName: nextPatient.patientName,
        tokenNumber: nextPatient.tokenNumber,
        symptoms: nextPatient.symptoms,
        appointmentType: nextPatient.appointmentType,
        priorityScore: nextPatient.priorityScore,
      },
    });
  } catch (error) {
    console.error('Call next patient error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Mark patient as completed/seen
 * POST /api/queue/:doctorId/complete/:patientId
 */
router.post('/:doctorId/complete/:patientId', authMiddleware, (req, res) => {
  try {
    const { doctorId, patientId } = req.params;
    const { notes, rating } = req.body;

    const updated = queueService.updatePatientStatus(doctorId, patientId, 'completed');

    if (!updated) {
      return res.status(404).json({
        error: 'Patient not found in queue',
      });
    }

    // Remove from active queue to cleanup
    queueService.removeFromQueue(doctorId, patientId, 'completed');

    res.json({
      success: true,
      message: 'Patient marked as completed',
      completed: true,
    });
  } catch (error) {
    console.error('Complete patient error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Mark patient as no-show
 * POST /api/queue/:doctorId/no-show/:patientId
 */
router.post('/:doctorId/no-show/:patientId', authMiddleware, (req, res) => {
  try {
    const { doctorId, patientId } = req.params;

    queueService.removeFromQueue(doctorId, patientId, 'no_show');

    res.json({
      success: true,
      message: 'Patient marked as no-show',
    });
  } catch (error) {
    console.error('No-show marking error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Reprioritize queue (when new urgent case arrives)
 * POST /api/queue/:doctorId/reprioritize
 */
router.post('/:doctorId/reprioritize', authMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { departmentName } = req.body;

    const result = await queueService.reprioritizeQueue(doctorId, departmentName);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Reprioritize queue error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Train/update ML model with historical data
 * POST /api/queue/train-model
 */
router.post('/train-model', authMiddleware, async (req, res) => {
  try {
    const { appointmentHistoryData } = req.body;

    if (!appointmentHistoryData || appointmentHistoryData.length === 0) {
      return res.status(400).json({
        error: 'No appointment history data provided',
      });
    }

    const result = await mlService.retrainModel(appointmentHistoryData);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Model training error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Recommend optimal appointment slot
 * POST /api/queue/recommend-slot
 */
router.post('/recommend-slot', authMiddleware, async (req, res) => {
  try {
    const { appointmentOptions } = req.body;

    if (!appointmentOptions || appointmentOptions.length === 0) {
      return res.status(400).json({
        error: 'No appointment options provided',
      });
    }

    // Get current queue status for all doctors
    const currentQueue = {};
    for (const option of appointmentOptions) {
      currentQueue[option.doctorId] = queueService.getQueueLength(option.doctorId);
    }

    const recommendation = await mlService.recommendOptimalSlot(appointmentOptions, currentQueue);

    res.json({
      success: true,
      ...recommendation,
    });
  } catch (error) {
    console.error('Slot recommendation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Clear completed patients from queue
 * POST /api/queue/:doctorId/cleanup
 */
router.post('/:doctorId/cleanup', authMiddleware, (req, res) => {
  try {
    const { doctorId } = req.params;

    const cleared = queueService.cleanupQueue(doctorId);

    res.json({
      success: true,
      message: `Cleaned up ${cleared} completed patients`,
      clearedCount: cleared,
    });
  } catch (error) {
    console.error('Queue cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
