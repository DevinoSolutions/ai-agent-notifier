// scripts/live-claude.mjs — Tier 2 live E2E for Claude Code (paid key).
// HARD checks (any failure exits non-zero):
//   1. ANTHROPIC_API_KEY must be present.
//   2. claude runs our prompt with the patched config and returns output.
//   3. the Stop hook delivers a real ntfy push.
// Requires ANTHROPIC_API_KEY in the environment.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchClaude } from '../setup/patch-config.mjs';
import { requireEnvKey, setupIsolatedHomeWithToast, pollForPush, randomTopic, nonceMarker } from './lib/live-driver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

async function main() {
  // HARD: the key must be set. A missing key is a configuration failure, not a
  // reason to silently skip.
  requireEnvKey('ANTHROPIC_API_KEY', {
    message: 'FAIL: ANTHROPIC_API_KEY is not set — live Claude E2E requires a real key.',
  });

  const topic = randomTopic('live-claude');
  const marker = nonceMarker('claude');
  const home = setupIsolatedHomeWithToast({ prefix: 'aan-live-claude-', dir: '.claude', topic, seedSettingsFile: 'settings.json' });
  patchClaude(path.join(home, '.claude'), NOTIFY);

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const res = spawnSync('claude', ['-p', `Reply with exactly this token and nothing else: ${marker}`], {
    encoding: 'utf8', env, timeout: 120000,
  });
  console.log('claude exit:', res.status);
  console.log('claude stdout:', (res.stdout || '').slice(0, 500));
  console.log('claude stderr:', (res.stderr || '').slice(0, 500));

  // HARD: the agent actually ran with our key + config.
  if (res.status !== 0 || !(res.stdout || '').trim()) {
    console.error('FAIL: claude did not run successfully');
    process.exit(1);
  }
  console.log('PASS (hard): claude ran with our config + key');

  // HARD: the Stop hook must deliver an ntfy push. If the hook does not fire in
  // this mode, fix how we drive the agent — do not weaken this check.
  await pollForPush({
    topic,
    match: (m) => m.title === 'Claude Code',
    failMessage: 'FAIL: Stop hook did not deliver an ntfy push within the poll window',
    passMessage: 'PASS (hard): Stop hook delivered an ntfy push',
  });

  // macOS only: prove the toast was actually DELIVERED (not just exit 0). The
  // claude toast body is rich content — the assistant's words — so it carries
  // our marker. Requires the runner's FDA grant (the workflow runs preflight).
  if (process.platform === 'darwin') {
    const { verifyDelivery } = await import('../src/platforms/macos-delivery.mjs');
    const del = await verifyDelivery(marker, { timeoutMs: 20000, pollMs: 1000 });
    if (!del.delivered) {
      console.error(`FAIL [PRODUCT]: no Notification Center delivery record for "${marker}" (${del.reason})`);
      process.exit(1);
    }
    console.log(`PASS (hard): NC delivery record present — title="${del.record.title}"`);
  }

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
