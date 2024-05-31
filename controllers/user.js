const User = require('../models/user'); // Import the Token model

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

module.exports = { retrieveOrCreateUser, deleteUser };