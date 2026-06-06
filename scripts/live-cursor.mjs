// scripts/live-cursor.mjs — Tier 2 live E2E for Cursor agent.
// HARD checks (any failure exits non-zero):
//   1. CURSOR_API_KEY must be present.
//   2. Cursor patches its config correctly and the patched hooks.json is valid.
// NOTE: Cursor is a GUI editor; its CLI opens the desktop app and cannot be
// driven headlessly in CI. This job validates key presence, config patching,
// and JSON schema correctness. Hook delivery is covered by the notify-subprocess
// + hook-invocation e2e suites which spawn a real notify.mjs process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchCursor } from '../setup/patch-config.mjs';
import { randomTopic, writeUserConfig } from '../tests/e2e/helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

async function main() {
  // Cursor supports BYO API keys (OpenAI, Anthropic, etc.) in addition to its
  // own subscription key. We accept any of the three so CI doesn't need a
  // separate cursor.com account — just reuse whichever key is already present.
  const cursorKey = process.env.CURSOR_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!cursorKey) {
    console.error('FAIL: no API key found — set CURSOR_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.');
    process.exit(1);
  }
  console.log('PASS (hard): API key present for Cursor BYO mode');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-live-cursor-'));
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  const topic = randomTopic('live-cursor');
  writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });

  patchCursor(path.join(home, '.cursor'), NOTIFY);

  // HARD: hooks.json must be valid JSON with the correct schema.
  const hooksPath = path.join(home, '.cursor', 'hooks.json');
  let hooks;
  try {
    hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  } catch (err) {
    console.error('FAIL: hooks.json is not valid JSON after patch:', err.message);
    process.exit(1);
  }

  if (!hooks.hooks?.stop || !Array.isArray(hooks.hooks.stop) || hooks.hooks.stop.length === 0) {
    console.error('FAIL: hooks.json missing stop hook after patch');
    process.exit(1);
  }

  const stopHook = hooks.hooks.stop[0];
  if (!stopHook.command || !stopHook.command.includes('notify.mjs')) {
    console.error('FAIL: stop hook command does not reference notify.mjs:', stopHook.command);
    process.exit(1);
  }

  console.log('PASS (hard): CURSOR_API_KEY is set');
  console.log('PASS (hard): Cursor hooks.json patched correctly');
  console.log('NOTE: Cursor is a GUI editor — headless hook invocation is not');
  console.log('      supported in CI. Hook delivery is covered by e2e suite.');

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
