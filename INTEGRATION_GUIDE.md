# Integration Guide: Adding ML Queue Management to Your Backend

## Step 1: Update Your Main Backend File

Add these lines to your `backend/index.js`:

```javascript
// ============================================
// ADD THIS TO YOUR index.js
// ============================================

// Import the new AI Queue Management routes
const aiQueueManagementRoutes = require('./src/routes/aiQueueManagement');

// Add this after your other route imports
// Around where you have other route definitions like:
// app.use('/api/auth', authRoutes);
// app.use('/api/doctor', doctorRoutes);

// ADD THIS LINE:
app.use('/api/queue', aiQueueManagementRoutes);

// ============================================
// COMPLETE EXAMPLE STRUCTURE
// ============================================

const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Existing routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/patient', require('./src/routes/patient'));
app.use('/api/doctor', require('./src/routes/doctor'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/notifications', require('./src/routes/notifications'));

// ✅ ADD NEW AI QUEUE MANAGEMENT ROUTES
app.use('/api/queue', require('./src/routes/aiQueueManagement'));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('✅ AI Queue Management API Ready!');
});
```

---

## Step 2: Create Integration Wrapper (Optional but Recommended)

Create a new file to make it easier to use across your app:

```bash
Create: backend/src/services/aiQueueWrapper.js
```

```javascript
/**
 * AI Queue Wrapper - Easy integration with existing services
 */

const MLWaitTimePredictionService = require('./mlWaitTimePredictionService');
const QueuePriorityManagementService = require('./queuePriorityManagementService');
const SymptomAnalysisService = require('./symptomAnalysisService');

class AIQueueWrapper {
  constructor() {
    this.mlService = new MLWaitTimePredictionService();
    this.queueService = new QueuePriorityManagementService();
  }

  /**
   * When patient books appointment, predict wait time
   */
  async onAppointmentBooked(appointmentData) {
    try {
      const prediction = await this.mlService.predictWaitTime({
        appointmentTime: appointmentData.appointmentTime,
        appointmentType: appointmentData.type,
        departmentName: appointmentData.department,
        doctorId: appointmentData.doctorId,
        symptoms: appointmentData.symptoms,
        patientAge: appointmentData.patientAge,
        currentQueueLength: appointmentData.queueLength,
      });

      return {
        estimatedWait: prediction.predictedWaitTime,
        confidence: prediction.confidence,
        message: `Your appointment is at ${appointmentData.appointmentTime}. Expected wait time: ${prediction.predictedWaitTime} minutes`,
      };
    } catch (error) {
      console.error('Error in onAppointmentBooked:', error);
      return null;
    }
  }

  /**
   * When patient arrives, add them to queue with priority
   */
  async onPatientArrival(patientData, appointmentData, doctorId, departmentName) {
    try {
      return await this.queueService.addToQueue(
        patientData,
        appointmentData,
        doctorId,
        departmentName
      );
    } catch (error) {
      console.error('Error in onPatientArrival:', error);
      return null;
    }
  }

  /**
   * Get queue status for doctor dashboard
   */
  async getDoctorDashboard(doctorId) {
    try {
      const queue = this.queueService.getQueueWithPredictions(doctorId);
      const analytics = this.queueService.getQueueAnalytics(doctorId);
      const nextPatient = this.queueService.getNextPatient(doctorId);

      return {
        currentQueue: queue,
        nextPatient: nextPatient,
        analytics: analytics,
        totalWaiting: queue.length,
      };
    } catch (error) {
      console.error('Error in getDoctorDashboard:', error);
      return null;
    }
  }

  /**
   * Get real-time update for patient waiting app
   */
  async getPatientStatus(doctorId, patientId) {
    try {
      return this.queueService.getQueueUpdateForPatient(doctorId, patientId);
    } catch (error) {
      console.error('Error in getPatientStatus:', error);
      return null;
    }
  }

  /**
   * Recommend best appointment slot for patient
   */
  async recommendBestSlot(appointmentOptions) {
    try {
      const currentQueue = {};
      for (const option of appointmentOptions) {
        currentQueue[option.doctorId] = this.queueService.getQueueLength(option.doctorId);
      }

      return await this.mlService.recommendOptimalSlot(appointmentOptions, currentQueue);
    } catch (error) {
      console.error('Error in recommendBestSlot:', error);
      return null;
    }
  }

  /**
   * Train model with historical data
   */
  async improveModel(historyData) {
    try {
      return await this.mlService.retrainModel(historyData);
    } catch (error) {
      console.error('Error in improveModel:', error);
      return null;
    }
  }
}

module.exports = AIQueueWrapper;
```

---

## Step 3: Update Your Existing Routes to Use ML

### Example: Update Patient Booking Route

In your `backend/src/routes/patient.js`:

```javascript
const AIQueueWrapper = require('../services/aiQueueWrapper');
const aiQueue = new AIQueueWrapper();

// Your existing appointment booking route
router.post('/book-appointment', authMiddleware, async (req, res) => {
  try {
    // ... your existing booking logic ...
    
    const appointment = new Appointment({
      patientId: req.user.id,
      doctorId: req.body.doctorId,
      departmentName: req.body.departmentName,
      appointmentTime: req.body.appointmentTime,
      symptoms: req.body.symptoms,
      type: req.body.type,
      // ... other fields
    });

    await appointment.save();

    // ✅ ADD THIS: Get AI prediction
    const aiPrediction = await aiQueue.onAppointmentBooked({
      appointmentTime: appointment.appointmentTime,
      type: appointment.type,
      department: appointment.departmentName,
      doctorId: appointment.doctorId,
      symptoms: appointment.symptoms,
      patientAge: req.user.age,
      queueLength: 5, // Get actual queue length
    });

    res.json({
      success: true,
      appointment,
      aiPrediction: aiPrediction, // ✅ Add wait time prediction
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Example: Update Queue Endpoint

In your `backend/src/routes/receptionist.js` or equivalent:

```javascript
const AIQueueWrapper = require('../services/aiQueueWrapper');
const aiQueue = new AIQueueWrapper();

// When patient arrives at OPD
router.post('/patient-arrival', authMiddleware, async (req, res) => {
  try {
    const { patientId, doctorId, departmentName, symptoms } = req.body;

    const patient = await User.findById(patientId);
    
    // ✅ ADD THEM TO AI QUEUE
    const queueResult = await aiQueue.onPatientArrival(
      {
        _id: patient._id,
        name: patient.name,
        age: patient.age,
        hasComorbidities: patient.hasComorbidities,
      },
      {
        symptoms: symptoms,
        appointmentType: 'regular',
        appointmentTime: new Date(),
      },
      doctorId,
      departmentName
    );

    res.json({
      success: true,
      ...queueResult,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Doctor dashboard - see AI queue
router.get('/dashboard/:doctorId', authMiddleware, async (req, res) => {
  try {
    const dashboard = await aiQueue.getDoctorDashboard(req.params.doctorId);
    
    res.json({
      success: true,
      dashboard,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## Step 4: Frontend Integration

### Example: React Component for Patient Wait Time

```javascript
// frontend/src/Components/QueueStatus.jsx

import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function QueueStatus({ patientId, doctorId }) {
  const [queueUpdate, setQueueUpdate] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchQueueStatus = async () => {
      try {
        const response = await axios.get(
          `/api/queue/${doctorId}/patient/${patientId}`,
          {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
          }
        );
        
        setQueueUpdate(response.data.queueUpdate);
      } catch (error) {
        console.error('Error fetching queue status:', error);
      } finally {
        setLoading(false);
      }
    };

    // Fetch immediately
    fetchQueueStatus();

    // Refresh every 30 seconds
    const interval = setInterval(fetchQueueStatus, 30000);

    return () => clearInterval(interval);
  }, [doctorId, patientId]);

  if (loading) return <div>Loading queue status...</div>;
  if (!queueUpdate) return <div>Not in queue</div>;

  return (
    <div className="queue-status">
      <h3>Queue Status</h3>
      <div className="status-card">
        <p><strong>Your Position:</strong> {queueUpdate.position}</p>
        <p><strong>Token Number:</strong> {queueUpdate.tokenNumber}</p>
        <p><strong>Estimated Wait Time:</strong> {queueUpdate.estimatedWaitTime} minutes</p>
        <p><strong>Patients Ahead:</strong> {queueUpdate.patientsAhead}</p>
        <p className="status-message">{queueUpdate.message}</p>
      </div>
    </div>
  );
}
```

---

## Step 5: Database Setup (Optional Model Training)

To train the model with historical data:

```javascript
// backend/src/scripts/trainQueueModel.js

const mongoose = require('mongoose');
const MLWaitTimePredictionService = require('../services/mlWaitTimePredictionService');
const Appointment = require('../models/Appointment'); // Your appointment model
require('dotenv').config();

async function trainQueueModel() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log('Fetching appointment history...');
    
    // Get last 1000 completed appointments
    const appointments = await Appointment.find({
      status: 'completed',
      completedAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } // Last 3 months
    }).limit(1000);

    console.log(`Found ${appointments.length} appointments for training`);

    // Format data for training
    const trainingData = appointments.map(apt => ({
      appointmentTime: apt.appointmentTime,
      department: apt.departmentName,
      doctorId: apt.doctorId,
      actualWaitTime: apt.actualWaitTime || 10, // minutes
      actualConsultationTime: apt.consultationTime || 12,
      symptoms: apt.symptoms,
    }));

    // Train model
    const mlService = new MLWaitTimePredictionService();
    const result = await mlService.retrainModel(trainingData);

    console.log('✅ Model trained successfully!');
    console.log(`   Accuracy: ${result.accuracy}`);
    console.log(`   Departments analyzed: ${result.departmentsAnalyzed}`);
    console.log(`   Doctors analyzed: ${result.doctorsAnalyzed}`);

    process.exit(0);
  } catch (error) {
    console.error('Error training model:', error);
    process.exit(1);
  }
}

trainQueueModel();
```

Run with: `node src/scripts/trainQueueModel.js`

---

## Step 6: Add to Package.json Scripts

```json
{
  "scripts": {
    "dev": "nodemon index.js",
    "start": "node index.js",
    "train-queue-model": "node src/scripts/trainQueueModel.js"
  }
}
```

---

## Testing the Integration

### Test 1: Predict Wait Time
```bash
curl -X POST http://localhost:5000/api/queue/predict-wait-time \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "appointmentTime": "2026-03-17T10:00:00",
    "appointmentType": "new_patient",
    "departmentName": "Cardiology",
    "doctorId": "doc123",
    "symptoms": "chest pain",
    "patientAge": 45,
    "currentQueueLength": 5
  }'
```

### Test 2: Add Patient to Queue
```bash
curl -X POST http://localhost:5000/api/queue/add-patient \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "patientId": "patient123",
    "patientName": "John Doe",
    "age": 45,
    "doctorId": "doc456",
    "departmentName": "Cardiology",
    "appointmentType": "new_patient",
    "symptoms": "chest pain"
  }'
```

### Test 3: Get Queue Status
```bash
curl -X GET http://localhost:5000/api/queue/doc456 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Summary

✅ **What you now have:**
- Custom ML wait time prediction
- AI-powered queue prioritization  
- Real-time patient updates
- Doctor dashboard with insights
- Fully integrated with your OPD system

✅ **Next steps:**
1. Update your `index.js` with the new routes
2. Test the APIs
3. Collect 3 months of data
4. Run the training script
5. Watch accuracy improve!

---

**Your system is now ready to intelligently manage patient queues!** 🚀
