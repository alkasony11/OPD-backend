const mongoose = require('mongoose');
const { Department, Doctor } = require('./models/Appointment');

const seedData = async () => {
  try {
    // Clear existing data
    await Department.deleteMany({});
    await Doctor.deleteMany({});

    // Create departments
    const departments = await Department.insertMany([
      {
        name: 'Cardiology',
        description: 'Heart and cardiovascular system care'
      },
      {
        name: 'Dermatology',
        description: 'Skin, hair, and nail treatments'
      },
      {
        name: 'Orthopedics',
        description: 'Bone, joint, and muscle care'
      },
      {
        name: 'Pediatrics',
        description: 'Healthcare for infants, children, and adolescents'
      },
      {
        name: 'Neurology',
        description: 'Brain and nervous system disorders'
      },
      {
        name: 'General Medicine',
        description: 'Primary healthcare and general medical conditions'
      },
      {
        name: 'Gynecology',
        description: 'Women\'s reproductive health'
      },
      {
        name: 'ENT',
        description: 'Ear, nose, and throat specialists'
      }
    ]);

    // Create doctors
    const doctors = [
      {
        name: 'Rajesh Kumar',
        email: 'dr.rajesh@hospital.com',
        phone: '+91-9876543210',
        specialization: 'Interventional Cardiology',
        department: departments[0]._id, // Cardiology
        qualification: 'MBBS, MD, DM Cardiology',
        experience: 15,
        consultationFee: 800,
        availableSlots: [
          { day: 'Monday', startTime: '09:00', endTime: '13:00', maxPatients: 20 },
          { day: 'Tuesday', startTime: '09:00', endTime: '13:00', maxPatients: 20 },
          { day: 'Wednesday', startTime: '09:00', endTime: '13:00', maxPatients: 20 },
          { day: 'Thursday', startTime: '09:00', endTime: '13:00', maxPatients: 20 },
          { day: 'Friday', startTime: '09:00', endTime: '13:00', maxPatients: 20 },
          { day: 'Saturday', startTime: '09:00', endTime: '12:00', maxPatients: 15 }
        ],
        avgConsultationTime: 20
      },
      {
        name: 'Priya Sharma',
        email: 'dr.priya@hospital.com',
        phone: '+91-9876543211',
        specialization: 'Cosmetic Dermatology',
        department: departments[1]._id, // Dermatology
        qualification: 'MBBS, MD Dermatology',
        experience: 12,
        consultationFee: 600,
        availableSlots: [
          { day: 'Monday', startTime: '10:00', endTime: '14:00', maxPatients: 25 },
          { day: 'Tuesday', startTime: '10:00', endTime: '14:00', maxPatients: 25 },
          { day: 'Wednesday', startTime: '10:00', endTime: '14:00', maxPatients: 25 },
          { day: 'Thursday', startTime: '10:00', endTime: '14:00', maxPatients: 25 },
          { day: 'Friday', startTime: '10:00', endTime: '14:00', maxPatients: 25 }
        ],
        avgConsultationTime: 15
      },
      {
        name: 'Amit Patel',
        email: 'dr.amit@hospital.com',
        phone: '+91-9876543212',
        specialization: 'Joint Replacement Surgery',
        department: departments[2]._id, // Orthopedics
        qualification: 'MBBS, MS Orthopedics',
        experience: 18,
        consultationFee: 900,
        availableSlots: [
          { day: 'Monday', startTime: '08:00', endTime: '12:00', maxPatients: 15 },
          { day: 'Wednesday', startTime: '08:00', endTime: '12:00', maxPatients: 15 },
          { day: 'Friday', startTime: '08:00', endTime: '12:00', maxPatients: 15 },
          { day: 'Saturday', startTime: '08:00', endTime: '11:00', maxPatients: 10 }
        ],
        avgConsultationTime: 25
      },
      {
        name: 'Sunita Reddy',
        email: 'dr.sunita@hospital.com',
        phone: '+91-9876543213',
        specialization: 'Child Development',
        department: departments[3]._id, // Pediatrics
        qualification: 'MBBS, MD Pediatrics',
        experience: 10,
        consultationFee: 500,
        availableSlots: [
          { day: 'Monday', startTime: '09:00', endTime: '13:00', maxPatients: 30 },
          { day: 'Tuesday', startTime: '09:00', endTime: '13:00', maxPatients: 30 },
          { day: 'Wednesday', startTime: '09:00', endTime: '13:00', maxPatients: 30 },
          { day: 'Thursday', startTime: '09:00', endTime: '13:00', maxPatients: 30 },
          { day: 'Friday', startTime: '09:00', endTime: '13:00', maxPatients: 30 },
          { day: 'Saturday', startTime: '09:00', endTime: '12:00', maxPatients: 20 }
        ],
        avgConsultationTime: 12
      },
      {
        name: 'Vikram Singh',
        email: 'dr.vikram@hospital.com',
        phone: '+91-9876543214',
        specialization: 'Stroke and Epilepsy',
        department: departments[4]._id, // Neurology
        qualification: 'MBBS, MD, DM Neurology',
        experience: 14,
        consultationFee: 1000,
        availableSlots: [
          { day: 'Tuesday', startTime: '10:00', endTime: '14:00', maxPatients: 12 },
          { day: 'Thursday', startTime: '10:00', endTime: '14:00', maxPatients: 12 },
          { day: 'Saturday', startTime: '10:00', endTime: '13:00', maxPatients: 10 }
        ],
        avgConsultationTime: 30
      },
      {
        name: 'Anita Gupta',
        email: 'dr.anita@hospital.com',
        phone: '+91-9876543215',
        specialization: 'Internal Medicine',
        department: departments[5]._id, // General Medicine
        qualification: 'MBBS, MD Internal Medicine',
        experience: 8,
        consultationFee: 400,
        availableSlots: [
          { day: 'Monday', startTime: '08:00', endTime: '12:00', maxPatients: 35 },
          { day: 'Tuesday', startTime: '08:00', endTime: '12:00', maxPatients: 35 },
          { day: 'Wednesday', startTime: '08:00', endTime: '12:00', maxPatients: 35 },
          { day: 'Thursday', startTime: '08:00', endTime: '12:00', maxPatients: 35 },
          { day: 'Friday', startTime: '08:00', endTime: '12:00', maxPatients: 35 },
          { day: 'Saturday', startTime: '08:00', endTime: '11:00', maxPatients: 25 }
        ],
        avgConsultationTime: 10
      },
      {
        name: 'Meera Joshi',
        email: 'dr.meera@hospital.com',
        phone: '+91-9876543216',
        specialization: 'High-Risk Pregnancy',
        department: departments[6]._id, // Gynecology
        qualification: 'MBBS, MS Gynecology',
        experience: 16,
        consultationFee: 700,
        availableSlots: [
          { day: 'Monday', startTime: '09:00', endTime: '13:00', maxPatients: 20 },
          { day: 'Tuesday', startTime: '09:00', endTime: '13:00', maxPatients: 20 },
          { day: 'Wednesday', startTime: '09:00', endTime: '13:00', maxPatients: 20 },
          { day: 'Thursday', startTime: '09:00', endTime: '13:00', maxPatients: 20 },
          { day: 'Friday', startTime: '09:00', endTime: '13:00', maxPatients: 20 }
        ],
        avgConsultationTime: 18
      },
      {
        name: 'Ravi Nair',
        email: 'dr.ravi@hospital.com',
        phone: '+91-9876543217',
        specialization: 'Sinus and Allergy',
        department: departments[7]._id, // ENT
        qualification: 'MBBS, MS ENT',
        experience: 11,
        consultationFee: 550,
        availableSlots: [
          { day: 'Monday', startTime: '10:00', endTime: '14:00', maxPatients: 25 },
          { day: 'Tuesday', startTime: '10:00', endTime: '14:00', maxPatients: 25 },
          { day: 'Wednesday', startTime: '10:00', endTime: '14:00', maxPatients: 25 },
          { day: 'Thursday', startTime: '10:00', endTime: '14:00', maxPatients: 25 },
          { day: 'Friday', startTime: '10:00', endTime: '14:00', maxPatients: 25 },
          { day: 'Saturday', startTime: '10:00', endTime: '13:00', maxPatients: 20 }
        ],
        avgConsultationTime: 15
      }
    ];

    await Doctor.insertMany(doctors);

    console.log('✅ Sample data seeded successfully!');
    console.log(`📋 Created ${departments.length} departments`);
    console.log(`👨‍⚕️ Created ${doctors.length} doctors`);
    
  } catch (error) {
    console.error('❌ Error seeding data:', error);
  }
};

module.exports = seedData;
