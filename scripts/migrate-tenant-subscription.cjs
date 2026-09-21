#!/usr/bin/env node
/**
 * One-time migration: split OrganisationSubscription (monolith) into Tenant + subscription period.
 * Run after deploying new models: node scripts/migrate-tenant-subscription.cjs
 * Requires MONGO_URI and MONGO_DB (same as index.js).
 */

require('dotenv').config({ path: './config.env' });
// Fallback to default .env loading if config.env is absent/incomplete.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const mongoURI = process.env.MONGO_URI;
const mongoDB = process.env.MONGO_DB;

if (!mongoURI || !mongoDB) {
  console.error('Set MONGO_URI and MONGO_DB');
  process.exit(1);
}

const UPLOAD_REL = path.join('uploads', 'org-report-templates');

function copyTemplateIfExists(fromId, toId) {
  const root = path.join(process.cwd(), UPLOAD_REL);
  const from = path.join(root, `${String(fromId).replace(/[^a-fA-F0-9]/g, '')}.docx`);
  const to = path.join(root, `${String(toId).replace(/[^a-fA-F0-9]/g, '')}.docx`);
  if (fs.existsSync(from) && !fs.existsSync(to)) {
    fs.copyFileSync(from, to);
    console.log(`Copied report template ${fromId} -> ${toId}`);
  }
}

async function main() {
  await mongoose.connect(mongoURI, { dbName: mongoDB });
  const db = mongoose.connection.db;

  const Tenant = require('../models/tenant');
  const OrganisationSubscription = require('../models/organisationSubscription');

  const subsCol = db.collection('OrganisationSubscriptions');
  const memCol = db.collection('OrganisationMemberships');
  const projCol = db.collection('Projects');

  const needsTenant = await subsCol
    .find({
      $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
    })
    .toArray();

  console.log(`OrganisationSubscriptions without tenantId: ${needsTenant.length}`);

  for (const raw of needsTenant) {
    if (raw.tenantId) continue;

    const tenantDoc = {
      organisationName: raw.organisationName || 'Organisation',
      emailDomain: String(raw.emailDomain || '').toLowerCase(),
      organisationAi: raw.organisationAi || {},
      organisationScanContext: raw.organisationScanContext || {},
      organisationScanGuidanceItems: raw.organisationScanGuidanceItems || [],
      reportTemplateOriginalName: raw.reportTemplateOriginalName || '',
      reportTemplateUploadedAt: raw.reportTemplateUploadedAt || null,
      reportAccentDetectedHex: raw.reportAccentDetectedHex || '',
      createdAt: raw.createdAt || new Date(),
      updatedAt: raw.updatedAt || new Date(),
    };

    const tenant = await Tenant.create(tenantDoc);
    console.log(`Created Tenant ${tenant._id} for subscription ${raw._id}`);

    copyTemplateIfExists(raw._id, tenant._id);

    await subsCol.updateOne(
      { _id: raw._id },
      {
        $set: { tenantId: tenant._id },
        $unset: {
          organisationName: '',
          emailDomain: '',
          organisationAi: '',
          organisationScanContext: '',
          organisationScanGuidanceItems: '',
          reportTemplateOriginalName: '',
          reportTemplateUploadedAt: '',
          reportAccentDetectedHex: '',
        },
      }
    );
  }

  const memWithSub = await memCol.find({ subscriptionId: { $exists: true } }).toArray();
  console.log(`Memberships with subscriptionId: ${memWithSub.length}`);

  for (const m of memWithSub) {
    const sub = await subsCol.findOne({ _id: m.subscriptionId });
    if (!sub || !sub.tenantId) {
      console.warn(`Skip membership ${m._id}: no tenant for subscription ${m.subscriptionId}`);
      continue;
    }
    await memCol.updateOne(
      { _id: m._id },
      { $set: { tenantId: sub.tenantId }, $unset: { subscriptionId: '' } }
    );
  }

  const projs = await projCol
    .find({
      sharedWithOrganisation: true,
      organisationSubscriptionId: { $exists: true, $ne: null },
      $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
    })
    .toArray();

  console.log(`Projects to link tenantId: ${projs.length}`);

  for (const p of projs) {
    const sub = await subsCol.findOne({ _id: p.organisationSubscriptionId });
    if (sub && sub.tenantId) {
      await projCol.updateOne({ _id: p._id }, { $set: { tenantId: sub.tenantId } });
    }
  }

  try {
    await memCol.dropIndex('subscriptionId_1_emailLower_1');
    console.log('Dropped legacy index subscriptionId_1_emailLower_1');
  } catch (e) {
    console.log('No legacy membership index to drop (or already dropped):', e.message);
  }

  await OrganisationSubscription.syncIndexes();
  await Tenant.syncIndexes();
  const OrganisationMembership = require('../models/organisationMembership');
  await OrganisationMembership.syncIndexes();

  console.log('Done.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
