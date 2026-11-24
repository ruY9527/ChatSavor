// Single source of truth: package.json version -> manifest.json + bridge.js SCRIPT_VERSION.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'manifest.json');
const bridgePath = path.join(root, 'src/content/bridge.js');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const checkOnly = process.argv.includes('--check');

const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
const bridgeRaw = fs.readFileSync(bridgePath, 'utf8');
const manifestVersion = JSON.parse(manifestRaw).version;
const bridgeMatch = /var SCRIPT_VERSION\s*=\s*'([^']+)'/.exec(bridgeRaw);
const bridgeVersion = bridgeMatch ? bridgeMatch[1] : null;

if (checkOnly) {
  const diffs = [];
  if (manifestVersion !== version) diffs.push(`manifest.json: ${manifestVersion} != ${version}`);
  if (bridgeVersion !== version) diffs.push(`bridge.js SCRIPT_VERSION: ${bridgeVersion} != ${version}`);
  if (diffs.length) {
    console.error('[sync-version] version mismatch:\n  ' + diffs.join('\n  '));
    process.exit(1);
  }
  console.log(`[sync-version] all versions aligned at ${version}`);
  process.exit(0);
}

let changed = false;
if (manifestVersion !== version) {
  const next = manifestRaw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
  fs.writeFileSync(manifestPath, next);
  changed = true;
}
if (bridgeVersion !== version) {
  const next = bridgeRaw.replace(/(var SCRIPT_VERSION\s*=\s*')[^']+(')/, `$1${version}$2`);
  fs.writeFileSync(bridgePath, next);
  changed = true;
}
console.log(`[sync-version] ${changed ? 'updated manifest.json and bridge.js' : 'already aligned'} at ${version}`);
