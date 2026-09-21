const mongoose = require('mongoose');
const User = require('../models/user');

/**
 * Normalize a value to a 24-char hex Mongo ObjectId string, or null.
 */
function normalizeMongoUserId(raw) {
  if (raw == null || raw === '') {
    return null;
  }
  if (raw instanceof mongoose.Types.ObjectId) {
    return raw.toHexString();
  }
  if (typeof raw === 'object') {
    if (raw._id != null) {
      return normalizeMongoUserId(raw._id);
    }
    if (typeof raw.toHexString === 'function') {
      try {
        return raw.toHexString();
      } catch {
        return null;
      }
    }
    if (raw.buffer && (Buffer.isBuffer(raw.buffer) || ArrayBuffer.isView(raw.buffer))) {
      try {
        return new mongoose.Types.ObjectId(raw.buffer).toHexString();
      } catch {
        return null;
      }
    }
    if (typeof raw.$oid === 'string') {
      return normalizeMongoUserId(raw.$oid);
    }
  }
  const s = String(raw).trim();
  if (/^[a-fA-F0-9]{24}$/.test(s)) {
    return s.toLowerCase();
  }
  return null;
}

function requireMongoUserId(raw) {
  const id = normalizeMongoUserId(raw);
  if (!id) {
    const err = new Error(
      'Session user id is missing or invalid. Please sign out and sign in again.'
    );
    err.status = 401;
    err.code = 'INVALID_SESSION_USER_ID';
    throw err;
  }
  return id;
}

function getSessionEmail(req) {
  if (!req) return null;
  const fromPassport =
    req.session &&
    req.session.passport &&
    req.session.passport.user &&
    req.session.passport.user.email;
  const fromUser = req.user && req.user.email;
  const fromLocals = req.res && req.res.locals && req.res.locals.user && req.res.locals.user.email;
  const email = fromPassport || fromUser || fromLocals;
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim();
  return trimmed.includes('@') ? trimmed : null;
}

/**
 * Look up CARE User by email (case-insensitive). OAuth `id` is ignored.
 * @param {string} email
 * @returns {Promise<import('mongoose').Document|null>}
 */
async function findUserByEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return null;
  }
  const emailLower = email.trim().toLowerCase();
  const escaped = emailLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({
    email: { $regex: new RegExp(`^${escaped}$`, 'i') },
  });
}

/**
 * Resolve the logged-in CARE user from session email.
 * Never uses OAuth provider ids (Google / Django).
 * @param {import('express').Request} req
 */
async function requireUserFromSession(req) {
  const email = getSessionEmail(req);
  if (!email) {
    const err = new Error('Authenticated user email is required');
    err.status = 401;
    err.code = 'MISSING_SESSION_EMAIL';
    throw err;
  }
  const user = await findUserByEmail(email);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  return user;
}

/**
 * Express middleware: set req.careUser from session email.
 * Use after ensureAuthenticated. Prefer req.careUser._id over passport.user.id.
 */
async function attachCareUser(req, res, next) {
  try {
    req.careUser = await requireUserFromSession(req);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  normalizeMongoUserId,
  requireMongoUserId,
  getSessionEmail,
  findUserByEmail,
  requireUserFromSession,
  attachCareUser,
};
