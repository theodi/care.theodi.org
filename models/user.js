// models/token.js

const mongoose = require('mongoose');

// Create user schema and model
const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    firstLogin: Date,
    lastLogin: Date,
    loginCount: Number,
    lastLoginFormatted: String,
  }, {
    collection: 'Users' // Specify the collection name
  });

  const User = mongoose.model('User', userSchema);

  module.exports = User;