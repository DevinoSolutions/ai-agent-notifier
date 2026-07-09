#!/usr/bin/env node
// scripts/run-tests.mjs — expand <dir>/*.test.mjs into an explicit file list
// for `node --test`.
//
// Why this exists: Windows shells (cmd/pwsh) do not expand globs, and node
// only learned to glob --test arguments itself in v21. So the obvious
// `node --test tests/*.test.mjs` passes the literal string through and finds
// nothing on Windows with node 18/20 — the exact versions the engines field
// promises. Expanding here makes `npm test` behave identically everywhere.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/run-tests.mjs <dir>');
  process.exit(1);
}

// Non-recursive on purpose: `tests` must not pick up `tests/e2e`.
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => `${dir}/${f}`)
  .sort();

if (files.length === 0) {
  console.error(`no *.test.mjs files found in ${dir}`);
  process.exit(1);
}

const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status ?? 1);
