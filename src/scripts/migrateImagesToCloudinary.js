const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { User } = require('../models/User');
const CloudinaryService = require('../services/cloudinaryService');
require('dotenv').config();

/**
 * Migration script to move existing local profile images to Cloudinary
 * This script will:
 * 1. Find all users with local profile_photo paths
 * 2. Upload those images to Cloudinary
 * 3. Update the user records with Cloudinary URLs
 * 4. Optionally delete the local files after successful upload
 */

const migrateImagesToCloudinary = async () => {
  try {
    console.log('🚀 Starting image migration to Cloudinary...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/opd');
    console.log('✅ Connected to MongoDB');

    // Find all users with local profile_photo paths
    const usersWithLocalPhotos = await User.find({
      profile_photo: { 
        $exists: true, 
        $ne: '', 
        $not: { $regex: /^https?:\/\// } // Not starting with http/https
      }
    });

    console.log(`📊 Found ${usersWithLocalPhotos.length} users with local profile photos`);

    if (usersWithLocalPhotos.length === 0) {
      console.log('✅ No local images to migrate');
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const user of usersWithLocalPhotos) {
      try {
        console.log(`\n🔄 Processing user: ${user.name} (${user._id})`);
        console.log(`   Current photo path: ${user.profile_photo}`);

        // Check if local file exists
        const localFilePath = path.join(__dirname, '../../', user.profile_photo);
        
        if (!fs.existsSync(localFilePath)) {
          console.log(`   ⚠️  Local file not found: ${localFilePath}`);
          console.log(`   🗑️  Removing invalid photo reference from database`);
          
          await User.findByIdAndUpdate(user._id, {
            $unset: { profile_photo: 1 }
          });
          
          errorCount++;
          errors.push({
            userId: user._id,
            userName: user.name,
            error: 'Local file not found',
            photoPath: user.profile_photo
          });
          continue;
        }

        // Upload to Cloudinary
        const publicId = `migrated-profile-${user._id}-${Date.now()}`;
        const uploadResult = await CloudinaryService.uploadImage(
          localFilePath, 
          'opd-profiles', 
          publicId
        );

        if (!uploadResult.success) {
          console.log(`   ❌ Upload failed: ${uploadResult.error}`);
          errorCount++;
          errors.push({
            userId: user._id,
            userName: user.name,
            error: uploadResult.error,
            photoPath: user.profile_photo
          });
          continue;
        }

        // Update user record with Cloudinary URL
        await User.findByIdAndUpdate(user._id, {
          $set: { 
            profile_photo: uploadResult.url,
            profileImage: uploadResult.url // Also set profileImage for compatibility
          }
        });

        console.log(`   ✅ Successfully uploaded to Cloudinary: ${uploadResult.url}`);

        // Optionally delete local file (uncomment if you want to delete after successful upload)
        // fs.unlinkSync(localFilePath);
        // console.log(`   🗑️  Deleted local file: ${localFilePath}`);

        successCount++;

      } catch (error) {
        console.log(`   ❌ Error processing user ${user._id}: ${error.message}`);
        errorCount++;
        errors.push({
          userId: user._id,
          userName: user.name,
          error: error.message,
          photoPath: user.profile_photo
        });
      }
    }

    // Print summary
    console.log('\n📈 Migration Summary:');
    console.log(`   ✅ Successfully migrated: ${successCount} images`);
    console.log(`   ❌ Failed migrations: ${errorCount} images`);
    console.log(`   📊 Total processed: ${usersWithLocalPhotos.length} users`);

    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach((error, index) => {
        console.log(`   ${index + 1}. User: ${error.userName} (${error.userId})`);
        console.log(`      Error: ${error.error}`);
        console.log(`      Photo Path: ${error.photoPath}`);
      });
    }

    // Save errors to file for review
    if (errors.length > 0) {
      const errorLogPath = path.join(__dirname, '../../migration-errors.json');
      fs.writeFileSync(errorLogPath, JSON.stringify(errors, null, 2));
      console.log(`\n📝 Error details saved to: ${errorLogPath}`);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
};

// Run migration if this script is executed directly
if (require.main === module) {
  migrateImagesToCloudinary()
    .then(() => {
      console.log('🎉 Migration completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

module.exports = migrateImagesToCloudinary;
