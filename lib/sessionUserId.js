const mongoose = require('mongoose');

/**
 * Normalize a session / passport user id to a 24-char hex string.
 * OAuth providers (Google) put their own id on `profile.id`; after login we
 * overwrite with the Mongo User `_id`. Sessions may also rehydrate ObjectIds
 * as strings or plain objects — reject anything that is not a valid ObjectId.
 *
 * @param {unknown} raw
 * @returns {string|null}
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
    // BSON extended JSON / accidental JSON of ObjectId
    if (typeof raw.$oid === 'string') {
      return normalizeMongoUserId(raw.$oid);
    }
  }
  const s = String(raw).trim();
  // Strict: Mongo ObjectIds are exactly 24 hex chars (rejects Google numeric ids)
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

module.exports = {
  normalizeMongoUserId,
  requireMongoUserId,
};
