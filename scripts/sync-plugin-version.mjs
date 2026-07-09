// scripts/sync-plugin-version.mjs — keep the Claude plugin manifests in lockstep
// with package.json's version so the npm/plugin/marketplace versions can never drift.
//
// Wired into the npm "version" lifecycle hook (see package.json), so any
// `npm version <patch|minor|major>` bump also rewrites the manifests and stages
// them in the same commit. Safe to run by hand at any time — it is idempotent.
//
// Zero dependencies. It rewrites only the "version" string values and leaves the
// rest of each file byte-for-byte intact (2-space indent, single-line keyword/tag
// arrays, trailing newline), so the diff is minimal. Exits 1 if a manifest is
// missing so a bump fails loudly instead of silently half-syncing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const pkgPath = path.join(root, 'package.json');
const targets = [
  path.join(root, '.claude-plugin', 'plugin.json'),
  path.join(root, '.claude-plugin', 'marketplace.json'),
];

const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
if (!version) {
  console.error('package.json has no "version" field — nothing to sync.');
  process.exit(1);
}

console.log(`Syncing plugin manifests to package.json version ${version}`);

let missing = false;
let changedAny = false;

for (const file of targets) {
  const rel = path.relative(root, file).replace(/\\/g, '/');

  if (!fs.existsSync(file)) {
    console.error(`  MISSING  ${rel}`);
    missing = true;
    continue;
  }

  const original = fs.readFileSync(file, 'utf8');
  // Every "version": "..." value in these manifests tracks the package version
  // (plugin.json has one; marketplace.json has metadata + per-plugin).
  const oldVersions = [...original.matchAll(/"version"\s*:\s*"([^"]*)"/g)].map((m) => m[1]);
  const updated = original.replace(/("version"\s*:\s*)"[^"]*"/g, (_match, prefix) => `${prefix}"${version}"`);

  if (updated === original) {
    console.log(`  ok       ${rel} (already ${version})`);
    continue;
  }

  fs.writeFileSync(file, updated);
  changedAny = true;
  const from = [...new Set(oldVersions)].join(', ') || '(unversioned)';
  const fields = oldVersions.length === 1 ? '1 field' : `${oldVersions.length} fields`;
  console.log(`  updated  ${rel} (${from} -> ${version}, ${fields})`);
}

if (!changedAny && !missing) {
  console.log(`All plugin manifests already at ${version} — nothing to do.`);
}

if (missing) {
  process.exit(1);
}
