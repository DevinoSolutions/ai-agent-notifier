#!/usr/bin/env node
// Fixture CLI for smoke-load harness tests.
// Reads the config file named by FAKE_CLI_CONFIG.
//  - If FAKE_CLI_IGNORE_CONFIG=1, it never reads config (simulates a probe that
//    does not parse config -> "launch-only").
//  - Else if the config contains "BREAK", it simulates a parse failure.
import fs from 'node:fs';

if (process.env.FAKE_CLI_IGNORE_CONFIG === '1') {
  process.stdout.write('fake-cli 1.0.0\n');
  process.exit(0);
}
let body = '';
try { body = fs.readFileSync(process.env.FAKE_CLI_CONFIG || '', 'utf8'); } catch { /* missing */ }
if (body.includes('BREAK')) {
  process.stderr.write('error: failed to parse config: duplicate key\n');
  process.exit(1);
}
process.stdout.write('fake-cli 1.0.0\n');
process.exit(0);
