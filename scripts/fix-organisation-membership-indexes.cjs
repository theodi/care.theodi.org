#!/usr/bin/env node
/**
 * Drops legacy unique index { subscriptionId, userId } on OrganisationMemberships.
 * That index treats missing userId as null, so only one member row per org was allowed
 * after moving identity to emailLower. Then syncs indexes from the Mongoose model.
 *
 * Usage: node scripts/fix-organisation-membership-indexes.cjs
 * Requires: config.env with MONGO_URI, MONGO_DB (same as the app).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'config.env') });
const mongoose = require('mongoose');
const OrganisationMembership = require('../models/organisationMembership');

const COLLECTION = 'OrganisationMemberships';

function isLegacyUserIdIndex(key) {
  if (!key || typeof key !== 'object') return false;
  const names = Object.keys(key);
  return (
    names.length === 2 &&
    names.includes('subscriptionId') &&
    names.includes('userId')
  );
}

async function main() {
  const uri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB;
  if (!uri || !dbName) {
    console.error('Set MONGO_URI and MONGO_DB in config.env');
    process.exit(1);
  }
  await mongoose.connect(uri, { dbName });
  const coll = mongoose.connection.collection(COLLECTION);
  const indexes = await coll.indexes();
  for (const idx of indexes) {
    if (idx.name === '_id_') continue;
    if (isLegacyUserIdIndex(idx.key)) {
      await coll.dropIndex(idx.name);
      console.log('Dropped legacy index:', idx.name, JSON.stringify(idx.key));
    }
  }
  await OrganisationMembership.syncIndexes();
  console.log('syncIndexes() completed for OrganisationMembership.');
  const after = await coll.indexes();
  console.log(
    'Current indexes:',
    after.map((i) => `${i.name}: ${JSON.stringify(i.key)}`).join('\n')
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
