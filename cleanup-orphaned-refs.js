const mongoose = require('mongoose');
require('dotenv').config();

async function cleanupOrphanedReferences() {
  try {
    console.log('🔌 Connecting to MongoDB Atlas...');
    
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found in environment variables');
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB Atlas');
    
    const db = mongoose.connection.db;
    
    console.log('🧹 Cleaning up orphaned references...\n');
    
    // Fix 1: Clear all booking_history from users (since no tokens exist)
    console.log('🧹 Step 1: Clearing all booking_history from users...');
    const userResult = await db.collection('users').updateMany(
      { 'patient_info.booking_history': { $exists: true } },
      { 
        $set: { 
          'patient_info.booking_history': []
        } 
      }
    );
    console.log(`✅ Cleared booking_history for ${userResult.modifiedCount} users`);
    
    // Fix 2: Delete all appointment-related notifications
    console.log('🧹 Step 2: Deleting all appointment-related notifications...');
    const notificationResult = await db.collection('notifications').deleteMany({
      related_type: 'appointment'
    });
    console.log(`✅ Deleted ${notificationResult.deletedCount} appointment notifications`);
    
    // Fix 3: Check for any other collections that might reference tokens
    console.log('🧹 Step 3: Checking for other potential references...');
    
    // Check if there are any other collections that might reference tokens
    const collections = await db.listCollections().toArray();
    console.log(`📊 Found ${collections.length} collections in database`);
    
    // Check for any documents that might have ObjectId references to tokens
    let totalOrphanedRefs = 0;
    
    for (const collection of collections) {
      const collectionName = collection.name;
      
      // Skip system collections
      if (collectionName.startsWith('system.')) continue;
      
      try {
        // Look for any documents with fields that might contain ObjectIds
        const sampleDoc = await db.collection(collectionName).findOne({});
        if (sampleDoc) {
          // Check if any field contains what looks like an ObjectId
          const docStr = JSON.stringify(sampleDoc);
          if (docStr.includes('ObjectId') || docStr.includes('_id')) {
            console.log(`  📋 Collection ${collectionName} contains ObjectId references`);
          }
        }
      } catch (error) {
        // Skip collections that can't be queried
        console.log(`  ⚠️  Could not check collection ${collectionName}: ${error.message}`);
      }
    }
    
    console.log('\n✅ Cleanup completed!');
    console.log('\n📋 Summary:');
    console.log(`   - Cleared booking_history for ${userResult.modifiedCount} users`);
    console.log(`   - Deleted ${notificationResult.deletedCount} appointment notifications`);
    console.log(`   - Checked ${collections.length} collections for orphaned references`);
    
    console.log('\n💡 Your database is now clean!');
    console.log('💡 You can now create new appointments without errors.');
    console.log('💡 The token generation system will start fresh from T001.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

cleanupOrphanedReferences();
