// models/user.js

const mongoose = require('mongoose');

// Create user schema and model
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, required: true },
    // Password is unused with current OAuth-only auth; keep it out of query
    // projections by default so it cannot be returned accidentally.
    password: { type: String, select: false },
    firstLogin: Date,
    lastLogin: Date,
    loginCount: Number,
    lastLoginFormatted: String,
  }, {
    collection: 'Users' // Specify the collection name
  });

  const User = mongoose.model('User', userSchema);

  module.exports = User;