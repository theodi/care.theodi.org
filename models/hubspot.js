// models/token.js

const mongoose = require('mongoose');

// Create user schema and model
const hubspotSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    hubSpotId: String,
    companyMembership: Boolean,
    membershipStatus: String,
    membershipType: String,
  }, {
    collection: 'Hubspot' // Specify the collection name
  });

  const Hubspot = mongoose.model('Hubspot', hubspotSchema);

  module.exports = Hubspot;