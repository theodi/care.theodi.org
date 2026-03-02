const path = require('path');
const cron = require('node-cron');
const crypto = require('crypto');
const User = require('../models/user'); // Import the Token model
const Project = require('../models/project');

// Load environment variables securely
require("dotenv").config({ path: "../config.env" });

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derivedKey = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  const a = Buffer.from(derivedKey, 'hex');
  const b = Buffer.from(key, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

let currentDefaultPassword = process.env.DEFAULT_PASSWORD || "defaultPassword123";

// Local accounts
async function retrieveUserByEmail(email) {
  let user = await User.findOne({ email });
  if (!user) {
    // Create a new user with a default password
    const hashedPassword = hashPassword(currentDefaultPassword);
    user = new User({
      name: email,
      email: email,
      password: hashedPassword,
      firstLogin: new Date(),
      loginCount: 0,
      lastLogin: new Date()
      // Add other user fields as necessary
    });
    await user.save();
  }
  return user;
}

// Local accounts
async function deleteLocalProjectsAndAccounts() {
  try {
    // Find all users that have a password set (local accounts)
    const users = await User.find({ password: { $exists: true, $ne: null } });
    const userIds = users.map(user => user._id);

    // Delete all projects owned by these users
    await Project.deleteMany({ owner: { $in: userIds } });

    // Delete the users themselves
    await User.deleteMany({ _id: { $in: userIds } });
  } catch (error) {
    console.log(error);
  }
}

async function updateDefaultPassword(newPassword) {
  currentDefaultPassword = newPassword;
}

async function getDefaultPassword(newPassword) {
  return currentDefaultPassword;
}

function generateRandomPassword(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return password;
}

// Schedule the task to run at 3:30 am UTC every day
cron.schedule('30 3 * * *', async () => {
  console.log('Running the scheduled task to delete local projects and accounts and reset password');
  await updateDefaultPassword(generateRandomPassword(12));
  await deleteLocalProjectsAndAccounts();
}, {
  timezone: "UTC"
});

// Function to retrieve or create a user based on the profile data
async function retrieveOrCreateUser(profile) {
    let user = await User.findOne({ email: profile.email });

    if (!user) {
      user = new User({
        name: profile.name,
        email: profile.email,
        firstLogin: new Date(),
        loginCount: 0,
        lastLogin: new Date()
      });
      await user.save();
    }

    return user;
}

async function deleteUser(userId) {
  try {
      // Find the user by their ID and delete it
      const deletedUser = await User.findByIdAndDelete(userId);
      return deletedUser;
  } catch (error) {
      throw error; // Propagate the error to the caller
  }
}

module.exports = {
  retrieveUserByEmail,
  retrieveOrCreateUser,
  deleteUser,
  deleteLocalProjectsAndAccounts,
  updateDefaultPassword,
  getDefaultPassword,
  hashPassword,
  verifyPassword
};