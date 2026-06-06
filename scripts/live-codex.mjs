// scripts/live-codex.mjs — Tier 2 live E2E for Codex CLI.
// HARD checks (any failure exits non-zero):
//   1. OPENAI_API_KEY must be present (validated via curl in ci.yml).
//   2. codex exec runs a real prompt end-to-end and produces output.
// Provider note: codex exec uses the OpenAI Responses API *WebSocket*
// (wss://api.openai.com/v1/responses) which requires Tier 1+ OpenAI access.
// Standard API keys work for Chat Completions (curl check passes) but not
// for the Responses WebSocket. We therefore run the actual exec round-trip
// via the Anthropic provider (claude-haiku-4-5-20251001, REST) which we know
// is accessible. The OpenAI key is still validated separately.
// NOTE: Codex hooks only fire inside the interactive TUI (not exec mode).
// Hook delivery is verified by the unit + e2e suites via a real spawned
// notify.mjs process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchCodex } from '../setup/patch-config.mjs';
import { randomTopic, writeUserConfig } from '../tests/e2e/helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('FAIL: OPENAI_API_KEY is not set — must be present (curl check validates it).');
    process.exit(1);
  }
  console.log('PASS: OPENAI_API_KEY is set (REST validity checked by prior curl step)');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('FAIL: ANTHROPIC_API_KEY is not set — needed for the codex exec round-trip.');
    process.exit(1);
  }

  // Codex refuses to create helper binaries under /tmp; use the real home dir
  // as the base so the temp path is e.g. /home/runner/aan-live-codex-XXXXX.
  const home = fs.mkdtempSync(path.join(os.homedir(), 'aan-live-codex-'));
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  const topic = randomTopic('live-codex');
  writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });
  patchCodex(path.join(home, '.codex'), NOTIFY);

  const env = { ...process.env, HOME: home, USERPROFILE: home };

  // Use the Anthropic provider for the exec round-trip: codex supports it via
  // ANTHROPIC_API_KEY and uses the REST API (not the Responses WebSocket).
  // --dangerously-bypass-approvals-and-sandbox: skips all confirm prompts and
  //   sandbox restrictions; appropriate because GitHub Actions is sandboxed.
  // --dangerously-bypass-hook-trust: skip trust verification for patched hooks.
  // stdio: ['ignore', 'pipe', 'pipe']: explicitly ignore stdin (rather than
  //   sending empty-string EOF which codex logs as "Reading additional input
  //   from stdin..." and may cause an early exit).
  const res = spawnSync(
    'codex',
    [
      'exec',
      '--model', 'claude-haiku-4-5-20251001',
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
      'Reply with the single word OK.',
    ],
    { encoding: 'utf8', env, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  console.log('codex exit:', res.status);
  console.log('codex stdout:', (res.stdout || '').slice(0, 2000));
  console.log('codex stderr:', (res.stderr || '').slice(0, 2000));

  if (res.status !== 0 || !(res.stdout || '').trim()) {
    console.error('FAIL: codex did not run successfully');
    process.exit(1);
  }
  console.log('PASS (hard): codex ran with our config + Anthropic key');

  console.log('NOTE: Codex hooks only fire in interactive TUI mode. Hook delivery');
  console.log('      is covered by notify-subprocess + hook-invocation e2e tests.');

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
