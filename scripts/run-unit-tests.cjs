#!/usr/bin/env node
/**
 * Node v24+ may treat `node --test <dir>` as a module path. Discover *.test.js instead.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const testDir = path.join(root, 'test');
const files = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => path.join(testDir, f))
  .sort();

if (files.length === 0) {
  console.error('No test/*.test.js files found');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(result.status === null ? 1 : result.status);
