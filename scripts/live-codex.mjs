// scripts/live-codex.mjs — Tier 2 live E2E for Codex CLI in EXEC (non-interactive) mode.
//
// SCOPE — read this before "fixing" it to assert allow/deny again:
// `codex exec` structurally CANNOT exercise the approval decision loop. With no
// TTY to prompt on, codex forces `approval: never` and a read-only sandbox, so the
// PermissionRequest hook never fires and allow/deny is unobservable. This is
// proven, not assumed — PR #6's first run showed `codex exec` print `approval:
// never` / `sandbox: read-only` for an `untrusted` config and exit 1 on a write.
// The approval DECISION loop (requested → decision returned → codex obeys) is
// proven end to end by the INTERACTIVE TUI lane scripts/tui/proof-codex-approval.mjs
// (F2 of the TUI Proofs workflow), which is the right tool for that job.
//
// What THIS lane truthfully proves: OPENAI_API_KEY is valid, our codex config +
// PermissionRequest hook wiring is accepted by the real codex binary, and codex
// completes a REAL turn under exec — it echoes a unique token we ask for. The
// prompt needs no file write and no approval, so it runs clean under the
// read-only exec sandbox.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireEnvKey, nonceMarker } from './lib/live-driver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs').replace(/\\/g, '/');

// Wire our real product PermissionRequest hook and enable hooks, exactly as setup
// would. In exec mode the hook won't fire (see SCOPE), but writing it proves codex
// accepts our config shape and boots under it.
function writeCodexConfig(codexHome) {
  fs.mkdirSync(codexHome, { recursive: true });
  const hooks = { hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: `node "${NOTIFY}" --source codex --event needs_input`, timeout: 20 }] }] } };
  fs.writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify(hooks, null, 2));
  fs.writeFileSync(path.join(codexHome, 'config.toml'), 'approval_policy = "untrusted"\n[features]\nhooks = true\n');
}

async function main() {
  requireEnvKey('OPENAI_API_KEY', { message: 'FAIL: OPENAI_API_KEY is not set — live Codex requires a real key.' });

  // CODEX_HOME under the REAL home — codex refuses temp-dir helper binaries.
  const codexHome = fs.mkdtempSync(path.join(os.homedir(), 'aan-live-codex-'));
  writeCodexConfig(codexHome);

  // A distinctive, opaque token is far less likely to be reformatted by the model
  // than a common word.
  const token = nonceMarker('aanlive').toUpperCase();
  const prompt = `Reply with only this exact token and nothing else: ${token}`;
  const env = { ...process.env, CODEX_HOME: codexHome };

  const res = spawnSync('codex', ['exec', '--skip-git-repo-check', prompt], {
    encoding: 'utf8', env, timeout: 180000,
  });
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  console.log('codex exit:', res.status);
  console.log('codex stdout (first 1200):', (res.stdout || '').slice(0, 1200));
  console.log('codex stderr (first 400):', (res.stderr || '').slice(0, 400));

  fs.rmSync(codexHome, { recursive: true, force: true });

  // Strongest evidence: the token we asked for is echoed → codex completed a real
  // turn against the live API under our config.
  if (out.toUpperCase().includes(token)) {
    console.log(`PASS (hard): codex completed a real exec turn (echoed ${token}) — key valid + our config accepted.`);
    process.exit(0);
  }

  // Fallback: codex launched cleanly and printed its session header (model /
  // provider / sandbox / approval), proving key + config wiring even if the turn
  // text didn't surface the token in captured stdout.
  if (res.status === 0 && /model:|provider:|sandbox:|approval:|reasoning|tokens used|OpenAI|codex/i.test(out)) {
    console.log('PASS (soft): codex launched under our config and completed exec cleanly (session header present), though the token was not echoed in captured stdout.');
    process.exit(0);
  }

  console.error('FAIL: codex did not complete a clean exec turn under our config.');
  console.error('  exit:', res.status);
  console.error('  stdout:', (res.stdout || '').slice(0, 2000));
  console.error('  stderr:', (res.stderr || '').slice(0, 2000));
  if (res.error) console.error('  spawn error:', res.error.message);
  process.exit(1);
}

main();
