// scripts/live-codex.mjs — Tier 2 live E2E for Codex (OPENAI_API_KEY).
// HARD checks (any failure exits non-zero):
//   1. OPENAI_API_KEY must be present.
//   2. codex runs our prompt in exec mode and produces output.
// NOTE: Codex hooks only fire inside the interactive TUI (not exec/--full-auto
// mode). Hook delivery is verified by the unit + e2e suites via a real spawned
// notify.mjs; the live job here validates API key auth and CLI connectivity.
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
    console.error('FAIL: OPENAI_API_KEY is not set — live Codex E2E requires a real key.');
    process.exit(1);
  }

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-live-codex-'));
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  const topic = randomTopic('live-codex');
  writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });
  patchCodex(path.join(home, '.codex'), NOTIFY);

  const env = { ...process.env, HOME: home, USERPROFILE: home };

  // `codex exec` is the non-interactive subcommand (no TUI, exits when done).
  // --dangerously-bypass-approvals-and-sandbox: skips all confirm prompts and
  //   sandbox restrictions; appropriate because GitHub Actions is already
  //   sandboxed at the runner level.
  // --ephemeral: don't persist session files to disk.
  // --dangerously-bypass-hook-trust: skip trust verification for patched hooks.
  // input: '' ensures stdin is empty so exec doesn't hang waiting for input.
  const res = spawnSync(
    'codex',
    [
      'exec',
      '--model', 'gpt-4o-mini',
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
      '--ephemeral',
      'Reply with the single word OK.',
    ],
    { encoding: 'utf8', env, timeout: 120000, input: '' },
  );
  console.log('codex exit:', res.status);
  console.log('codex stdout:', (res.stdout || '').slice(0, 500));
  console.log('codex stderr:', (res.stderr || '').slice(0, 500));

  if (res.status !== 0 || !(res.stdout || '').trim()) {
    console.error('FAIL: codex did not run successfully');
    process.exit(1);
  }
  console.log('PASS (hard): codex ran with our config + key');

  console.log('NOTE: Codex hooks only fire in interactive TUI mode. Hook delivery');
  console.log('      is covered by notify-subprocess + hook-invocation e2e tests.');

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
