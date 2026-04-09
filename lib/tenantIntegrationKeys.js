const crypto = require('crypto');
const mongoose = require('mongoose');

const TOKEN_PREFIX = 'careti_';

function getPepper() {
  const p = process.env.TENANT_INTEGRATION_API_PEPPER || process.env.SESSION_SECRET || '';
  if (!p) {
    throw new Error('TENANT_INTEGRATION_API_PEPPER or SESSION_SECRET must be set for integration API keys');
  }
  return p;
}

function hashIntegrationToken(plaintextToken) {
  return crypto.createHmac('sha256', getPepper()).update(plaintextToken).digest('hex');
}

/**
 * @returns {{ plaintext: string, keyHash: string, prefix: string, keyId: mongoose.Types.ObjectId }}
 */
function generateIntegrationApiKey() {
  const keyId = new mongoose.Types.ObjectId();
  const secretPart = crypto.randomBytes(24).toString('hex');
  const plaintext = `${TOKEN_PREFIX}${keyId.toString()}_${secretPart}`;
  const keyHash = hashIntegrationToken(plaintext);
  const prefix = plaintext.slice(0, 18);
  return { plaintext, keyHash, prefix, keyId };
}

/**
 * @returns {{ keyId: string, fullToken: string } | null}
 */
function parseIntegrationBearerToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m = trimmed.match(/^careti_([a-fA-F0-9]{24})_(.+)$/);
  if (!m) return null;
  return { keyId: m[1], fullToken: trimmed };
}

function verifyIntegrationToken(plaintextToken, keyHashHex) {
  const computed = hashIntegrationToken(plaintextToken);
  if (!keyHashHex || computed.length !== keyHashHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(keyHashHex, 'utf8'));
}

module.exports = {
  generateIntegrationApiKey,
  parseIntegrationBearerToken,
  hashIntegrationToken,
  verifyIntegrationToken,
  TOKEN_PREFIX,
};
