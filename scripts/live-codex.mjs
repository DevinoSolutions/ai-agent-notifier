// scripts/live-codex.mjs — Tier 2 live E2E for Codex CLI.
// HARD checks (any failure exits non-zero):
//   1. OPENAI_API_KEY must be present (REST validity checked via curl in live-codex.yml).
//   2. Codex config (~/.codex/hooks.json + config.toml) must patch correctly.
//   3. Patched hooks.json must be valid and reference notify.mjs.
//
// Why no codex exec API round-trip:
//   codex exec uses the OpenAI Responses API *WebSocket*
//   (wss://api.openai.com/v1/responses) which requires Tier 1+ OpenAI access
//   (account must have spent $5+). Standard API keys satisfy Chat Completions
//   but not the Responses WebSocket. The curl pre-check in live-codex.yml validates
//   that the key is live; codex CLI installation is covered by the smoke-load
//   job. This job focuses on what's unique to Codex: config patching.
//
// NOTE: Codex hooks only fire inside the interactive TUI (not exec mode).
// Hook delivery is verified by the unit + e2e suites via a real spawned
// notify.mjs process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchCodex } from '../setup/patch-config.mjs';
import { requireEnvKey, setupIsolatedHome, assertHooksJsonPatched, randomTopic } from './lib/live-driver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

async function main() {
  requireEnvKey('OPENAI_API_KEY', {
    message: 'FAIL: OPENAI_API_KEY is not set — must be present (curl check validates it).',
  });
  console.log('PASS (hard): OPENAI_API_KEY is present (REST validity checked by prior curl step)');

  // Codex refuses to create helper binaries under /tmp; use the real home dir.
  const topic = randomTopic('live-codex');
  const home = setupIsolatedHome({ prefix: 'aan-live-codex-', dir: '.codex', topic, base: os.homedir() });

  patchCodex(path.join(home, '.codex'), NOTIFY);

  // HARD: hooks.json must be valid JSON referencing notify.mjs under the Stop hook.
  assertHooksJsonPatched(path.join(home, '.codex', 'hooks.json'), { event: 'Stop' });
  console.log('PASS (hard): Codex hooks.json patched correctly');

  // HARD: config.toml must enable the hooks feature flag.
  const tomlPath = path.join(home, '.codex', 'config.toml');
  const toml = fs.readFileSync(tomlPath, 'utf8');
  if (!toml.includes('hooks = true')) {
    console.error('FAIL: config.toml missing hooks = true after patch');
    process.exit(1);
  }

  console.log('PASS (hard): config.toml has hooks = true');
  console.log('NOTE: codex exec requires Tier 1+ OpenAI access (Responses WebSocket).');
  console.log('      API key validity is checked via curl; CLI install via smoke-load.');
  console.log('NOTE: Codex hooks only fire in interactive TUI mode. Hook delivery');
  console.log('      is covered by notify-subprocess + hook-invocation e2e tests.');

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
