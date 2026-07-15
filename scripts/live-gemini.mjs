// scripts/live-gemini.mjs — Tier 2 live E2E for Gemini (free tier).
// HARD checks (any failure exits non-zero):
//   1. GEMINI_API_KEY must be present.
//   2. gemini runs our prompt with the patched config and returns output.
//   3. the AfterAgent hook delivers a real ntfy push.
// Requires GEMINI_API_KEY in the environment.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchGemini } from '../setup/patch-config.mjs';
import { requireEnvKey, setupIsolatedHomeWithToast, pollForPush, randomTopic } from './lib/live-driver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

async function main() {
  // HARD: the key must be set. A missing key is a configuration failure, not a
  // reason to silently skip.
  requireEnvKey('GEMINI_API_KEY', {
    message: 'FAIL: GEMINI_API_KEY is not set — live Gemini E2E requires a real key.',
  });

  const topic = randomTopic('live-gemini');
  const home = setupIsolatedHomeWithToast({ prefix: 'aan-live-gemini-', dir: '.gemini', topic, seedSettingsFile: 'settings.json' });
  patchGemini(path.join(home, '.gemini'), NOTIFY);

  // GEMINI_CLI_TRUST_WORKSPACE=true is required for headless/CI runs;
  // without it gemini exits 55 ("not running in a trusted directory").
  const env = { ...process.env, HOME: home, USERPROFILE: home, GEMINI_CLI_TRUST_WORKSPACE: 'true' };
  // Non-interactive prompt. If this flag is wrong for the installed version,
  // the hard assertion below will catch it and we adjust.
  const res = spawnSync('gemini', ['-p', 'Reply with the single word OK.'], {
    encoding: 'utf8', env, timeout: 120000,
  });
  console.log('gemini exit:', res.status);
  console.log('gemini stdout:', (res.stdout || '').slice(0, 500));
  console.log('gemini stderr:', (res.stderr || '').slice(0, 500));

  // HARD: the agent actually ran with our key + config.
  if (res.status !== 0 || !(res.stdout || '').trim()) {
    console.error('FAIL: gemini did not run successfully');
    process.exit(1);
  }
  console.log('PASS (hard): gemini ran with our config + key');

  // HARD: the AfterAgent hook must deliver an ntfy push. If the hook does not
  // fire in this mode, fix how we drive the agent — do not weaken this check.
  await pollForPush({
    topic,
    match: (m) => m.title === 'Gemini',
    failMessage: 'FAIL: AfterAgent hook did not deliver an ntfy push within the poll window',
    passMessage: 'PASS (hard): AfterAgent hook delivered an ntfy push',
  });

  if (process.platform === 'darwin') {
    const { verifyDelivery } = await import('../src/platforms/macos-delivery.mjs');
    // SOFT (best-effort, non-fatal): same finding as the Claude lane — reading back a toast fired
    // through the REAL agent hook depends on usernoted's ASYNC commit under a loaded post-turn runner
    // and is intermittent to observe (PR #6). The HARD osascript->NC positive-delivery proof lives in
    // the dedicated Toast macOS lane (toast-macos.yml). Observe + log here; do NOT fail this required
    // check on it. (The "Gemini"-title match is also a weak, non-nonce assertion — another reason to
    // keep it diagnostic-only rather than gating.)
    const del = await verifyDelivery('Gemini', { timeoutMs: 45000, pollMs: 1000 });
    if (del.delivered) {
      console.log(`PASS (soft): NC delivery record present via the real agent hook — title="${del.record.title}" body="${del.record.body}"`);
    } else {
      console.warn(`WARN (soft, non-fatal): NC record titled "Gemini" not observed within 45s (${del.reason}). The agent turn + hook + ntfy push all passed; osascript->NC delivery is hard-proven in the Toast macOS lane.`);
    }
  }

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
