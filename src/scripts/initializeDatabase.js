const mongoose = require('mongoose');
const { User, Token } = require('../models/User');
const DoctorSchedule = require('../models/DoctorSchedule');
const DoctorStats = require('../models/DoctorStats');

async function initializeDatabase() {
  try {
    console.log('🔧 Initializing database indexes and optimizations...');

    // Ensure all indexes are created (with error handling)
    const models = [
      { name: 'User', model: User },
      { name: 'Token', model: Token },
      { name: 'DoctorSchedule', model: DoctorSchedule },
      { name: 'DoctorStats', model: DoctorStats }
    ];

    for (const { name, model } of models) {
      try {
        await model.createIndexes();
        console.log(`   ✅ ${name} model indexes created`);
      } catch (error) {
        if (error.code === 86 || error.codeName === 'IndexKeySpecsConflict') {
          console.log(`   ⚠️  ${name} model indexes already exist`);
        } else {
          console.log(`   ❌ Error creating ${name} indexes: ${error.message}`);
        }
      }
    }

    // Create additional performance indexes (with error handling)
    console.log('📊 Creating additional performance indexes...');

    const indexesToCreate = [
      // Token collection performance indexes
      {
        collection: Token.collection,
        index: { doctor_id: 1, booking_date: 1, status: 1 },
        options: { name: 'doctor_date_status_idx' }
      },
      {
        collection: Token.collection,
        index: { patient_id: 1, booking_date: -1 },
        options: { name: 'patient_recent_appointments_idx' }
      },
      {
        collection: Token.collection,
        index: { booking_date: 1, status: 1 },
        options: { name: 'date_status_idx' }
      },
      {
        collection: Token.collection,
        index: { symptoms: 'text', department: 'text' },
        options: { name: 'symptoms_department_text_idx' }
      },
      // User collection performance indexes
      {
        collection: User.collection,
        index: { role: 1, 'doctor_info.department': 1 },
        options: { name: 'role_department_idx' }
      },
      {
        collection: User.collection,
        index: { name: 'text', email: 'text' },
        options: { name: 'user_search_text_idx' }
      },
      // DoctorSchedule performance indexes
      {
        collection: DoctorSchedule.collection,
        index: { doctor_id: 1, is_available: 1, date: 1 },
        options: { name: 'doctor_availability_date_idx' }
      },
      // DoctorStats performance indexes
      {
        collection: DoctorStats.collection,
        index: { cache_expires_at: 1 },
        options: { name: 'cache_expiry_idx' }
      }
    ];

    let indexesCreated = 0;
    let indexesSkipped = 0;

    for (const { collection, index, options } of indexesToCreate) {
      try {
        await collection.createIndex(index, options);
        console.log(`   ✅ Created index: ${options.name}`);
        indexesCreated++;
      } catch (error) {
        if (error.code === 86 || error.codeName === 'IndexKeySpecsConflict') {
          console.log(`   ⚠️  Index already exists: ${options.name}`);
          indexesSkipped++;
        } else {
          console.log(`   ❌ Failed to create index ${options.name}: ${error.message}`);
        }
      }
    }

    console.log(`📊 Index creation summary: ${indexesCreated} created, ${indexesSkipped} skipped`);

    console.log('✅ Database initialization completed successfully!');
    console.log('📈 Performance indexes created for optimal query performance');

    // Display index information
    const collections = ['users', 'tokens', 'doctorschedules', 'doctorstats'];
    
    for (const collectionName of collections) {
      try {
        const indexes = await mongoose.connection.db.collection(collectionName).indexes();
        console.log(`\n📋 ${collectionName.toUpperCase()} Collection Indexes:`);
        indexes.forEach(index => {
          console.log(`   - ${index.name}: ${JSON.stringify(index.key)}`);
        });
      } catch (error) {
        console.log(`   Collection ${collectionName} not found or no indexes`);
      }
    }

  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
}

// Function to optimize existing data
async function optimizeExistingData() {
  try {
    console.log('\n🔄 Optimizing existing data...');

    // Update any tokens without cancellation_reason field
    const tokensUpdated = await Token.updateMany(
      { cancellation_reason: { $exists: false } },
      { $set: { cancellation_reason: '' } }
    );
    console.log(`📝 Updated ${tokensUpdated.modifiedCount} tokens with cancellation_reason field`);

    // Ensure all doctors have default working hours
    const doctorsUpdated = await User.updateMany(
      { 
        role: 'doctor',
        'doctor_info.default_working_hours': { $exists: false }
      },
      {
        $set: {
          'doctor_info.default_working_hours': {
            start_time: '09:00',
            end_time: '17:00'
          },
          'doctor_info.default_break_time': {
            start_time: '13:00',
            end_time: '14:00'
          },
          'doctor_info.default_slot_duration': 30
        }
      }
    );
    console.log(`👨‍⚕️ Updated ${doctorsUpdated.modifiedCount} doctors with default working hours`);

    // Create stats entries for all doctors
    const doctors = await User.find({ role: 'doctor' }).select('_id');
    let statsCreated = 0;

    for (const doctor of doctors) {
      const existingStats = await DoctorStats.findOne({ doctor_id: doctor._id });
      if (!existingStats) {
        await DoctorStats.create({
          doctor_id: doctor._id,
          last_calculated: new Date(0), // Force recalculation
          cache_expires_at: new Date(0)
        });
        statsCreated++;
      }
    }
    console.log(`📊 Created stats entries for ${statsCreated} doctors`);

    console.log('✅ Data optimization completed!');

  } catch (error) {
    console.error('❌ Data optimization error:', error);
    throw error;
  }
}

// Function to validate data integrity
async function validateDataIntegrity() {
  try {
    console.log('\n🔍 Validating data integrity...');

    // Check for orphaned tokens (tokens without valid patient or doctor)
    const orphanedTokens = await Token.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'patient_id',
          foreignField: '_id',
          as: 'patient'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'doctor_id',
          foreignField: '_id',
          as: 'doctor'
        }
      },
      {
        $match: {
          $or: [
            { patient: { $size: 0 } },
            { doctor: { $size: 0 } }
          ]
        }
      },
      {
        $count: 'orphanedCount'
      }
    ]);

    const orphanedCount = orphanedTokens[0]?.orphanedCount || 0;
    if (orphanedCount > 0) {
      console.log(`⚠️  Found ${orphanedCount} orphaned tokens`);
    } else {
      console.log('✅ No orphaned tokens found');
    }

    // Check for schedules without valid doctors
    const orphanedSchedules = await DoctorSchedule.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'doctor_id',
          foreignField: '_id',
          as: 'doctor'
        }
      },
      {
        $match: {
          doctor: { $size: 0 }
        }
      },
      {
        $count: 'orphanedCount'
      }
    ]);

    const orphanedScheduleCount = orphanedSchedules[0]?.orphanedCount || 0;
    if (orphanedScheduleCount > 0) {
      console.log(`⚠️  Found ${orphanedScheduleCount} orphaned schedules`);
    } else {
      console.log('✅ No orphaned schedules found');
    }

    console.log('✅ Data integrity validation completed!');

  } catch (error) {
    console.error('❌ Data integrity validation error:', error);
    throw error;
  }
}

// Main initialization function
async function runDatabaseInitialization() {
  try {
    await initializeDatabase();
    await optimizeExistingData();
    await validateDataIntegrity();
    
    console.log('\n🎉 Database initialization and optimization completed successfully!');
    console.log('🚀 Your MongoDB database is now optimized for the Doctor Dashboard');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Export functions for use in other scripts
module.exports = {
  initializeDatabase,
  optimizeExistingData,
  validateDataIntegrity,
  runDatabaseInitialization
};

// Run if called directly
if (require.main === module) {
  // Connect to MongoDB
  require('dotenv').config();
  
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/opd', {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => {
    console.log('📡 Connected to MongoDB');
    return runDatabaseInitialization();
  })
  .then(() => {
    console.log('🏁 Initialization complete, closing connection...');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Connection or initialization error:', error);
    process.exit(1);
  });
}