// scripts/live-codex.mjs — Tier 2 live E2E for Codex CLI: the REAL approval loop.
// Proves: codex reaches an approval point → our PermissionRequest hook fires the
// product notification AND returns a decision → codex obeys (sentinel appears on
// allow, is absent on deny).
//
// macOS NC-delivery coverage for codex is DEFERRED: this lane does not set up a
// toast-enabled notifier home, and whether `codex exec` even fires the
// PermissionRequest hook on the runner is still unverified (see EMPIRICAL BRANCH
// below) — deferred pending the first PR CI result. The osascript → Notification
// Center delivery path is already proven by the live-claude, live-gemini, and
// toast-macos lanes.
//
// EMPIRICAL BRANCH — `codex exec` vs. `codex proto`:
// The exact `codex exec` approval-forcing invocation may need adjustment to the
// pinned codex version's flags. The TUI-proof memory notes `codex exec` may not
// surface approvals the same way the TUI does — if `codex exec` bypasses
// PermissionRequest under `untrusted`, drive the approval through the `codex
// proto` app-server exchange instead, which the codex research documents as the
// deterministic path: ExecApprovalRequest → Op::ExecApproval. Validate the exec
// path in the first CI run; if approvals don't fire in exec mode, switch this
// driver to the `codex proto` harness. This is called out as the one lane with
// an empirical branch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireEnvKey, nonceMarker } from './lib/live-driver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, 'codex-approval-hook.mjs');

function writeCodexConfig(codexHome) {
  fs.mkdirSync(codexHome, { recursive: true });
  // Approval-requiring policy so PermissionRequest fires; wire our harness hook.
  const hooks = { hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: `node "${HOOK.replace(/\\/g, '/')}"`, timeout: 30 }] }] } };
  fs.writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify(hooks, null, 2));
  fs.writeFileSync(path.join(codexHome, 'config.toml'),
    `approval_policy = "untrusted"\n[features]\nhooks = true\n`);
}

async function runOnce(decision) {
  requireEnvKey('OPENAI_API_KEY', { message: 'FAIL: OPENAI_API_KEY is not set — live Codex requires a real key.' });
  const codexHome = fs.mkdtempSync(path.join(os.homedir(), `aan-live-codex-${decision}-`));
  const sentinel = path.join(codexHome, `sentinel-${nonceMarker('cdx')}.txt`);
  writeCodexConfig(codexHome);

  const env = { ...process.env, CODEX_HOME: codexHome, AAN_TEST_DECISION: decision };
  // Ask codex to run a shell command that creates the sentinel — which requires
  // approval under the untrusted policy.
  const res = spawnSync('codex', ['exec', '--skip-git-repo-check',
    `Run this shell command to create a file: touch "${sentinel}"`], {
    encoding: 'utf8', env, timeout: 180000,
  });
  console.log(`[${decision}] codex exit:`, res.status);
  console.log(`[${decision}] stdout:`, (res.stdout || '').slice(0, 800));
  console.log(`[${decision}] stderr:`, (res.stderr || '').slice(0, 400));

  const created = fs.existsSync(sentinel);
  fs.rmSync(codexHome, { recursive: true, force: true });
  return { created, res };
}

async function main() {
  // ALLOW run: hook returns allow → codex runs the command → sentinel exists.
  const allow = await runOnce('allow');
  if (!allow.created) {
    console.error('FAIL [PRODUCT]: allow decision returned but sentinel was NOT created — codex did not obey allow.');
    process.exit(1);
  }
  console.log('PASS (hard): allow → codex executed the guarded command (sentinel created).');

  // DENY run: hook returns deny → codex must NOT run the command → no sentinel.
  const deny = await runOnce('deny');
  if (deny.created) {
    console.error('FAIL [PRODUCT]: deny decision returned but sentinel WAS created — codex ignored deny.');
    process.exit(1);
  }
  console.log('PASS (hard): deny → codex blocked the guarded command (no sentinel).');

  console.log('Full approval loop proven: requested → decision returned → codex obeyed.');
  process.exit(0);
}

main();
