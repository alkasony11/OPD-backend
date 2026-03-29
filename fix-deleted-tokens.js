const mongoose = require('mongoose');
const User = require('./src/models/User');
const Token = require('./src/models/ConsultationRecord');
const Notification = require('./src/models/Notification');
const FamilyMember = require('./src/models/FamilyMember');

// Script to fix database integrity issues after direct token deletion
async function fixDeletedTokens() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/opd', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Connected to MongoDB');
    console.log('🔧 Starting database integrity fix...\n');
    
    // Step 1: Find all existing tokens
    const existingTokens = await Token.find({}).select('_id token_number');
    const existingTokenIds = existingTokens.map(t => t._id.toString());
    const existingTokenNumbers = existingTokens.map(t => t.token_number).filter(Boolean);
    
    console.log(`📊 Found ${existingTokens.length} existing tokens`);
    console.log(`📊 Token numbers: ${existingTokenNumbers.join(', ')}\n`);
    
    // Step 2: Clean up User booking_history
    console.log('🧹 Step 1: Cleaning up User booking_history...');
    
    const usersWithBookingHistory = await User.find({
      'patient_info.booking_history': { $exists: true, $ne: [] }
    });
    
    let totalOrphanedReferences = 0;
    let usersFixed = 0;
    
    for (const user of usersWithBookingHistory) {
      const originalLength = user.patient_info.booking_history.length;
      
      // Remove references to non-existent tokens
      user.patient_info.booking_history = user.patient_info.booking_history.filter(
        tokenId => existingTokenIds.includes(tokenId.toString())
      );
      
      const orphanedCount = originalLength - user.patient_info.booking_history.length;
      if (orphanedCount > 0) {
        await user.save();
        totalOrphanedReferences += orphanedCount;
        usersFixed++;
        console.log(`  ✅ User ${user.name} (${user.email}): Removed ${orphanedCount} orphaned references`);
      }
    }
    
    console.log(`📊 Fixed ${usersFixed} users, removed ${totalOrphanedReferences} orphaned booking_history references\n`);
    
    // Step 3: Clean up Notifications
    console.log('🧹 Step 2: Cleaning up Notifications...');
    
    const appointmentNotifications = await Notification.find({
      related_type: 'appointment',
      related_id: { $exists: true }
    });
    
    let orphanedNotifications = 0;
    
    for (const notification of appointmentNotifications) {
      if (!existingTokenIds.includes(notification.related_id.toString())) {
        await Notification.findByIdAndDelete(notification._id);
        orphanedNotifications++;
        console.log(`  ✅ Deleted orphaned notification: ${notification.title}`);
      }
    }
    
    console.log(`📊 Removed ${orphanedNotifications} orphaned notifications\n`);
    
    // Step 4: Check for other potential issues
    console.log('🔍 Step 3: Checking for other integrity issues...');
    
    // Check for tokens with invalid doctor references
    const tokensWithInvalidDoctors = await Token.find({
      doctor_id: { $exists: true }
    }).populate('doctor_id');
    
    let invalidDoctorRefs = 0;
    for (const token of tokensWithInvalidDoctors) {
      if (!token.doctor_id) {
        invalidDoctorRefs++;
        console.log(`  ⚠️  Token ${token.token_number} has invalid doctor reference`);
      }
    }
    
    // Check for tokens with invalid patient references
    const tokensWithInvalidPatients = await Token.find({
      patient_id: { $exists: true }
    }).populate('patient_id');
    
    let invalidPatientRefs = 0;
    for (const token of tokensWithInvalidPatients) {
      if (!token.patient_id) {
        invalidPatientRefs++;
        console.log(`  ⚠️  Token ${token.token_number} has invalid patient reference`);
      }
    }
    
    // Check for tokens with invalid family member references
    const tokensWithFamilyMembers = await Token.find({
      family_member_id: { $exists: true, $ne: null }
    }).populate('family_member_id');
    
    let invalidFamilyMemberRefs = 0;
    for (const token of tokensWithFamilyMembers) {
      if (!token.family_member_id) {
        invalidFamilyMemberRefs++;
        console.log(`  ⚠️  Token ${token.token_number} has invalid family member reference`);
      }
    }
    
    console.log(`📊 Found ${invalidDoctorRefs} tokens with invalid doctor references`);
    console.log(`📊 Found ${invalidPatientRefs} tokens with invalid patient references`);
    console.log(`📊 Found ${invalidFamilyMemberRefs} tokens with invalid family member references\n`);
    
    // Step 5: Fix token number conflicts
    console.log('🔧 Step 4: Checking for token number conflicts...');
    
    const tokenNumberCounts = {};
    const duplicateTokens = [];
    
    for (const token of existingTokens) {
      if (token.token_number) {
        if (tokenNumberCounts[token.token_number]) {
          duplicateTokens.push(token);
          console.log(`  ⚠️  Duplicate token number found: ${token.token_number}`);
        } else {
          tokenNumberCounts[token.token_number] = token._id;
        }
      }
    }
    
    if (duplicateTokens.length > 0) {
      console.log(`📊 Found ${duplicateTokens.length} tokens with duplicate numbers`);
      console.log('  💡 Consider regenerating token numbers for these tokens\n');
    } else {
      console.log('✅ No duplicate token numbers found\n');
    }
    
    // Step 6: Generate summary report
    console.log('📋 SUMMARY REPORT:');
    console.log('==================');
    console.log(`✅ Users fixed: ${usersFixed}`);
    console.log(`✅ Orphaned booking_history references removed: ${totalOrphanedReferences}`);
    console.log(`✅ Orphaned notifications removed: ${orphanedNotifications}`);
    console.log(`⚠️  Tokens with invalid doctor references: ${invalidDoctorRefs}`);
    console.log(`⚠️  Tokens with invalid patient references: ${invalidPatientRefs}`);
    console.log(`⚠️  Tokens with invalid family member references: ${invalidFamilyMemberRefs}`);
    console.log(`⚠️  Tokens with duplicate numbers: ${duplicateTokens.length}`);
    
    if (invalidDoctorRefs > 0 || invalidPatientRefs > 0 || invalidFamilyMemberRefs > 0) {
      console.log('\n🚨 WARNING: Some tokens have invalid references that need manual attention!');
      console.log('   Consider deleting these tokens or fixing their references.');
    }
    
    if (duplicateTokens.length > 0) {
      console.log('\n🚨 WARNING: Some tokens have duplicate numbers!');
      console.log('   This will cause booking failures. Consider regenerating token numbers.');
    }
    
    console.log('\n✅ Database integrity fix completed!');
    
  } catch (error) {
    console.error('❌ Error during database fix:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Additional function to regenerate token numbers for duplicate tokens
async function regenerateTokenNumbers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/opd', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Connected to MongoDB');
    console.log('🔧 Starting token number regeneration...\n');
    
    // Find all tokens with duplicate numbers
    const tokens = await Token.find({}).sort({ created_at: 1 });
    const tokenNumberMap = new Map();
    const tokensToFix = [];
    
    for (const token of tokens) {
      if (token.token_number) {
        if (tokenNumberMap.has(token.token_number)) {
          tokensToFix.push(token);
          console.log(`  🔄 Token ${token._id} has duplicate number: ${token.token_number}`);
        } else {
          tokenNumberMap.set(token.token_number, token._id);
        }
      }
    }
    
    if (tokensToFix.length === 0) {
      console.log('✅ No duplicate token numbers found!');
      return;
    }
    
    console.log(`\n🔄 Regenerating token numbers for ${tokensToFix.length} tokens...`);
    
    // Group tokens by doctor and date for proper numbering
    const tokensByDoctorDate = {};
    
    for (const token of tokensToFix) {
      const key = `${token.doctor_id}_${token.booking_date.toDateString()}`;
      if (!tokensByDoctorDate[key]) {
        tokensByDoctorDate[key] = [];
      }
      tokensByDoctorDate[key].push(token);
    }
    
    for (const [key, doctorDateTokens] of Object.entries(tokensByDoctorDate)) {
      console.log(`\n📅 Processing ${doctorDateTokens.length} tokens for ${key}`);
      
      // Get all existing tokens for this doctor/date (including non-duplicates)
      const allTokensForDate = await Token.find({
        doctor_id: doctorDateTokens[0].doctor_id,
        booking_date: {
          $gte: new Date(doctorDateTokens[0].booking_date).setHours(0, 0, 0, 0),
          $lt: new Date(doctorDateTokens[0].booking_date).setHours(23, 59, 59, 999)
        }
      }).sort({ created_at: 1 });
      
      // Find used token numbers
      const usedNumbers = allTokensForDate
        .map(t => {
          const match = t.token_number?.match(/T(\d+)/);
          return match ? parseInt(match[1]) : null;
        })
        .filter(num => num !== null);
      
      console.log(`  📊 Used numbers: [${usedNumbers.join(', ')}]`);
      
      // Regenerate numbers for duplicate tokens
      let nextNumber = 1;
      for (const token of doctorDateTokens) {
        while (usedNumbers.includes(nextNumber)) {
          nextNumber++;
        }
        
        const newTokenNumber = `T${nextNumber.toString().padStart(3, '0')}`;
        console.log(`  🔄 ${token.token_number} → ${newTokenNumber}`);
        
        token.token_number = newTokenNumber;
        await token.save();
        
        usedNumbers.push(nextNumber);
        nextNumber++;
      }
    }
    
    console.log('\n✅ Token number regeneration completed!');
    
  } catch (error) {
    console.error('❌ Error during token regeneration:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--regenerate-tokens')) {
    await regenerateTokenNumbers();
  } else {
    await fixDeletedTokens();
    
    // Ask if user wants to regenerate token numbers
    console.log('\n💡 To regenerate duplicate token numbers, run:');
    console.log('   node fix-deleted-tokens.js --regenerate-tokens');
  }
}

// Run the script
main().catch(console.error);
