// scripts/live-cursor.mjs — Tier 2 live E2E for Cursor agent.
// HARD checks (any failure exits non-zero):
//   1. A usable API key must be present (CURSOR_API_KEY or a BYO OpenAI/Anthropic key).
//   2. Cursor patches its config correctly and the patched hooks.json is valid.
// NOTE: Cursor is a GUI editor; its CLI opens the desktop app and cannot be
// driven headlessly in CI. This job validates key presence, config patching,
// and JSON schema correctness. Hook delivery is covered by the notify-subprocess
// + hook-invocation e2e suites which spawn a real notify.mjs process.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchCursor } from '../setup/patch-config.mjs';
import { requireAnyEnvKey, setupIsolatedHome, assertHooksJsonPatched, randomTopic } from './lib/live-driver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

async function main() {
  // Cursor supports BYO API keys (OpenAI, Anthropic, etc.) in addition to its
  // own subscription key. We accept any of the three so CI doesn't need a
  // separate cursor.com account — just reuse whichever key is already present.
  const keyName = requireAnyEnvKey(['CURSOR_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'], {
    message: 'FAIL: no API key found — set CURSOR_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.',
  });
  console.log('PASS (hard): API key present for Cursor BYO mode');

  const topic = randomTopic('live-cursor');
  const home = setupIsolatedHome({ prefix: 'aan-live-cursor-', dir: '.cursor', topic });

  patchCursor(path.join(home, '.cursor'), NOTIFY);

  // HARD: hooks.json must be valid JSON referencing notify.mjs under the stop hook.
  assertHooksJsonPatched(path.join(home, '.cursor', 'hooks.json'), { event: 'stop' });

  // Report the env var that actually supplied the key (not a hardcoded name).
  console.log(`PASS (hard): ${keyName} is set`);
  console.log('PASS (hard): Cursor hooks.json patched correctly');
  console.log('NOTE: Cursor is a GUI editor — headless hook invocation is not');
  console.log('      supported in CI. Hook delivery is covered by e2e suite.');

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
