const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const Diagnosis = require('../models/Diagnosis');
const { User, Token } = require('../models/User');

// Get all diagnoses with filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { 
      patient_id, 
      doctor_id, 
      department, 
      status, 
      page = 1, 
      limit = 20,
      date_from,
      date_to
    } = req.query;

    let query = {};

    // Apply filters
    if (patient_id) query.patient_id = patient_id;
    if (doctor_id) query.doctor_id = doctor_id;
    if (department) query.department = department;
    if (status) query.consultation_status = status;

    // Date range filter
    if (date_from || date_to) {
      query.createdAt = {};
      if (date_from) {
        const fromDate = new Date(date_from);
        fromDate.setHours(0, 0, 0, 0);
        query.createdAt.$gte = fromDate;
      }
      if (date_to) {
        const toDate = new Date(date_to);
        toDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = toDate;
      }
    }

    const skip = (page - 1) * limit;

    const diagnoses = await Diagnosis.find(query)
      .populate('appointment_id', 'token_number booking_date time_slot')
      .populate('patient_id', 'name email phone')
      .populate('doctor_id', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Diagnosis.countDocuments(query);

    res.json({
      diagnoses,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get diagnoses error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get diagnosis by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const diagnosis = await Diagnosis.findById(req.params.id)
      .populate('appointment_id', 'token_number booking_date time_slot')
      .populate('patient_id', 'name email phone patient_info')
      .populate('doctor_id', 'name email doctor_info');

    if (!diagnosis) {
      return res.status(404).json({ message: 'Diagnosis not found' });
    }

    res.json({ diagnosis });
  } catch (error) {
    console.error('Get diagnosis error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new diagnosis
router.post('/', authMiddleware, async (req, res) => {
  try {
    const diagnosisData = req.body;

    // Validate required fields
    const requiredFields = [
      'appointment_id', 'patient_id', 'doctor_id', 'patient_name', 
      'patient_age', 'patient_gender', 'chief_complaint', 
      'history_of_present_illness', 'primary_diagnosis', 'doctor_name', 'department'
    ];

    for (const field of requiredFields) {
      if (!diagnosisData[field]) {
        return res.status(400).json({ 
          message: `${field} is required` 
        });
      }
    }

    // Check if diagnosis already exists for this appointment
    const existingDiagnosis = await Diagnosis.findOne({ 
      appointment_id: diagnosisData.appointment_id 
    });

    if (existingDiagnosis) {
      return res.status(400).json({ 
        message: 'Diagnosis already exists for this appointment' 
      });
    }

    const diagnosis = await Diagnosis.createDiagnosis(diagnosisData);

    // Update appointment status to 'consulted'
    await Token.findByIdAndUpdate(diagnosisData.appointment_id, {
      status: 'consulted',
      consultation_date: new Date()
    });

    res.status(201).json({ 
      message: 'Diagnosis created successfully',
      diagnosis 
    });
  } catch (error) {
    console.error('Create diagnosis error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update diagnosis
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const diagnosisData = req.body;
    const diagnosisId = req.params.id;

    const diagnosis = await Diagnosis.findByIdAndUpdate(
      diagnosisId,
      diagnosisData,
      { new: true, runValidators: true }
    );

    if (!diagnosis) {
      return res.status(404).json({ message: 'Diagnosis not found' });
    }

    res.json({ 
      message: 'Diagnosis updated successfully',
      diagnosis 
    });
  } catch (error) {
    console.error('Update diagnosis error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// End consultation
router.put('/:id/end-consultation', authMiddleware, async (req, res) => {
  try {
    const diagnosis = await Diagnosis.findById(req.params.id);

    if (!diagnosis) {
      return res.status(404).json({ message: 'Diagnosis not found' });
    }

    if (diagnosis.consultation_status === 'completed') {
      return res.status(400).json({ 
        message: 'Consultation already ended' 
      });
    }

    await diagnosis.endConsultation();

    res.json({ 
      message: 'Consultation ended successfully',
      diagnosis: {
        id: diagnosis._id,
        consultation_status: diagnosis.consultation_status,
        consultation_end_time: diagnosis.consultation_end_time,
        consultation_duration: diagnosis.consultation_duration
      }
    });
  } catch (error) {
    console.error('End consultation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get diagnoses by department
router.get('/department/:department', authMiddleware, async (req, res) => {
  try {
    const { department } = req.params;
    const { status, page = 1, limit = 20 } = req.query;

    let query = { department };

    if (status) {
      query.consultation_status = status;
    }

    const skip = (page - 1) * limit;

    const diagnoses = await Diagnosis.find(query)
      .populate('appointment_id', 'token_number booking_date time_slot')
      .populate('patient_id', 'name email phone')
      .populate('doctor_id', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Diagnosis.countDocuments(query);

    res.json({
      diagnoses,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get diagnoses by department error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient's diagnosis history
router.get('/patient/:patientId', authMiddleware, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (page - 1) * limit;

    const diagnoses = await Diagnosis.find({ patient_id: patientId })
      .populate('appointment_id', 'token_number booking_date time_slot')
      .populate('doctor_id', 'name email doctor_info')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Diagnosis.countDocuments({ patient_id: patientId });

    res.json({
      diagnoses,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get patient diagnosis history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete diagnosis (admin only)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const diagnosis = await Diagnosis.findByIdAndDelete(req.params.id);

    if (!diagnosis) {
      return res.status(404).json({ message: 'Diagnosis not found' });
    }

    res.json({ message: 'Diagnosis deleted successfully' });
  } catch (error) {
    console.error('Delete diagnosis error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
