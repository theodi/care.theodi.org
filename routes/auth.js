// authRoutes.js

const express = require('express');
const passport = require('../passport'); // Require the passport module

const { retrieveOrCreateUser } = require('../controllers/user');
const { getHubspotUser } = require('../controllers/hubspot');

const router = express.Router();

async function processLogin(req, res) {
  try {
    const profile = req.session.passport ? req.session.passport.user : req.session.user;
    const user = await retrieveOrCreateUser(profile);

    // Update last login data
    user.lastLoginFormatted = user.lastLogin.toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    user.lastLogin = new Date();
    user.loginCount = user.loginCount + 1;

    // Save the user
    await user.save();

    req.session.passport.user.id = user._id;

    await getHubspotUser(user._id,user.email);

  } catch (error) {
    console.log(error);
  }
}

// Authentication route for Google
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Authentication route for Django
router.get('/django',
  passport.authenticate('django')
);

// Callback endpoint for Google authentication
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/error' }),
  async (req, res) => {
    req.session.authMethod = 'google';
    // Successful authentication, redirect to profile page or wherever needed
    await processLogin(req);
    res.redirect('/projects');
  }
);

// Callback endpoint for Django authentication
router.get('/django/callback',
  passport.authenticate('django', { failureRedirect: '/error' }),
  async (req, res) => {
    req.session.authMethod = 'django';
    await processLogin(req);
    res.redirect('/projects');
  }
);

module.exports = router;