const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/drawing_game';

  mongoose.connection.on('connected', () => {
    console.log('✅  MongoDB connected');
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌  MongoDB error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️   MongoDB disconnected – retrying…');
  });

  try {
    await mongoose.connect(uri);
  } catch (err) {
    console.error(`❌  Initial MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
