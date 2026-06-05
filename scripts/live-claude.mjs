// scripts/live-claude.mjs — Tier 2 live E2E for Claude Code (paid key).
// Hard: claude runs a prompt and returns output. Soft: the Stop hook produces
// an ntfy push. Requires ANTHROPIC_API_KEY in the environment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchClaude } from '../setup/patch-config.mjs';
import { randomTopic, writeUserConfig, ntfyPoll } from '../tests/e2e/helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-live-claude-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}\n');
  const topic = randomTopic('live-claude');
  writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });
  patchClaude(path.join(home, '.claude'), NOTIFY);

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const res = spawnSync('claude', ['-p', 'Reply with the single word OK.'], {
    encoding: 'utf8', env, timeout: 120000,
  });
  console.log('claude exit:', res.status);
  console.log('claude stdout:', (res.stdout || '').slice(0, 500));
  console.log('claude stderr:', (res.stderr || '').slice(0, 500));

  if (res.status !== 0 || !(res.stdout || '').trim()) {
    console.error('FAIL: claude did not run successfully');
    process.exit(1);
  }
  console.log('PASS (hard): claude ran with our config + key');

  const msg = await ntfyPoll({ topic, attempts: 8, delayMs: 1500, match: (m) => m.title === 'Claude Code' });
  if (msg) console.log('PASS (soft): Stop hook delivered an ntfy push');
  else console.log('NOTE (soft): no ntfy push — hook may not fire in -p mode');

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
