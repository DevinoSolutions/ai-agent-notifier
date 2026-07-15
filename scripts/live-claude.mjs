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
    // SOFT (best-effort, non-fatal): reading a toast back after it is fired through claude's REAL
    // Stop hook depends on usernoted's ASYNC commit under a warm, loaded post-turn runner — which is
    // intermittent to observe here (green on 3e175c7, then missed within a full 45s window on both
    // 313d0f3 and bddb658, PR #6), unlike a quiet direct fire. The HARD osascript->NC positive-delivery
    // guarantee lives in the dedicated Toast macOS lane (toast-macos.yml), which is reliably green.
    // So we OBSERVE and log it here but do NOT fail this required check on it — a required check must
    // not hinge on an intermittently-observable async commit. This lane's HARD proof is: a real Claude
    // turn + the real Stop hook + a real ntfy push round-trip (all asserted above).
    const del = await verifyDelivery(marker, { timeoutMs: 45000, pollMs: 1000 });
    if (del.delivered) {
      console.log(`PASS (soft): NC delivery record present via the real agent hook — title="${del.record.title}"`);
    } else {
      console.warn(`WARN (soft, non-fatal): NC record for "${marker}" not observed within 45s (${del.reason}). The agent turn + Stop hook + ntfy push all passed; osascript->NC delivery is hard-proven in the Toast macOS lane.`);
    }
  }

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
