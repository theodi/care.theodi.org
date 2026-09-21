const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { normalizeMongoUserId, requireMongoUserId } = require('../lib/sessionUserId');

describe('sessionUserId', () => {
  it('accepts a 24-char hex string', () => {
    const id = '507f1f77bcf86cd799439011';
    assert.equal(normalizeMongoUserId(id), id);
  });

  it('accepts an ObjectId instance', () => {
    const oid = new mongoose.Types.ObjectId();
    assert.equal(normalizeMongoUserId(oid), oid.toHexString());
  });

  it('rejects Google-style numeric provider ids', () => {
    assert.equal(normalizeMongoUserId('117234567890123456789'), null);
  });

  it('requireMongoUserId throws 401 for invalid ids', () => {
    assert.throws(
      () => requireMongoUserId('not-an-objectid'),
      (err) => err.status === 401 && err.code === 'INVALID_SESSION_USER_ID'
    );
  });
});
