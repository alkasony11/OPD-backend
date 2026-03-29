const mongoose = require('mongoose');
const { Token } = require('./src/models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('Connected to MongoDB');
        try {
            console.log('Dropping index: token_number_1');
            await Token.collection.dropIndex('token_number_1');
            console.log('✅ Index dropped successfully');
        } catch (error) {
            if (error.code === 27) {
                console.log('ℹ️ Index not found (already dropped?)');
            } else {
                console.error('❌ Error dropping index:', error.message);
            }
        } finally {
            mongoose.disconnect();
        }
    })
    .catch(err => {
        console.error('Connection error:', err);
        process.exit(1);
    });
