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
    // Gemini's toast is generic ("<project>: Needs your input" / title "Gemini").
    // Fresh runner ⇒ the only "Gemini"-titled record in the window is ours.
    const del = await verifyDelivery('Gemini', { timeoutMs: 20000, pollMs: 1000 });
    if (!del.delivered) {
      console.error(`FAIL [PRODUCT]: no Notification Center delivery record titled "Gemini" (${del.reason})`);
      process.exit(1);
    }
    console.log(`PASS (hard): NC delivery record present — title="${del.record.title}" body="${del.record.body}"`);
  }

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
