const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('./src/models/User');
require('dotenv').config();

const seedAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/opd');

    console.log('Connected to MongoDB');

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.error('ADMIN_EMAIL not found in environment variables');
      process.exit(1);
    }

    // Check if admin user already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      console.log('Admin user already exists');
      
      // Update role if not admin
      if (existingAdmin.role !== 'admin') {
        existingAdmin.role = 'admin';
        existingAdmin.admin_info = {
          permissions: ['all']
        };
        await existingAdmin.save();
        console.log('Updated existing user to admin role');
      }
      
      process.exit(0);
    }

    // Create admin user
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    const adminUser = new User({
      name: 'System Administrator',
      email: adminEmail,
      password: hashedPassword,
      phone: '',
      role: 'admin',
      isVerified: true,
      authProvider: 'local',
      admin_info: {
        permissions: ['all']
      }
    });

    await adminUser.save();
    console.log('Admin user created successfully');
    console.log('Email:', adminEmail);
    console.log('Password:', adminPassword);
    console.log('Please change the password after first login');

  } catch (error) {
    console.error('Error seeding admin user:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

// Run the seeding function
seedAdmin();
