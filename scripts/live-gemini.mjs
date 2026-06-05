// scripts/live-gemini.mjs — Tier 2 live E2E for Gemini (free tier).
// Hard: gemini runs a prompt and returns output. Soft: the AfterAgent hook
// produces an ntfy push. Requires GEMINI_API_KEY in the environment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchGemini } from '../setup/patch-config.mjs';
import { randomTopic, writeUserConfig, ntfyPoll } from '../tests/e2e/helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-live-gemini-'));
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), '{}\n');
  const topic = randomTopic('live-gemini');
  writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });
  patchGemini(path.join(home, '.gemini'), NOTIFY);

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  // Non-interactive prompt. If this flag is wrong for the installed version,
  // the hard assertion below will catch it and we adjust.
  const res = spawnSync('gemini', ['-p', 'Reply with the single word OK.'], {
    encoding: 'utf8', env, timeout: 120000,
  });
  console.log('gemini exit:', res.status);
  console.log('gemini stdout:', (res.stdout || '').slice(0, 500));
  console.log('gemini stderr:', (res.stderr || '').slice(0, 500));

  // HARD: the agent actually ran.
  if (res.status !== 0 || !(res.stdout || '').trim()) {
    console.error('FAIL: gemini did not run successfully');
    process.exit(1);
  }
  console.log('PASS (hard): gemini ran with our config + key');

  // SOFT: did the hook fire into ntfy?
  const msg = await ntfyPoll({ topic, attempts: 8, delayMs: 1500, match: (m) => m.title === 'Gemini' });
  if (msg) console.log('PASS (soft): AfterAgent hook delivered an ntfy push');
  else console.log('NOTE (soft): no ntfy push — hook may not fire in non-interactive mode');

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
