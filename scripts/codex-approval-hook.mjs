// scripts/codex-approval-hook.mjs — TEST HARNESS ONLY (not shipped product).
// A codex PermissionRequest Command hook that (1) fires the real product
// notification via notify.mjs, then (2) returns the decision from
// AAN_TEST_DECISION so we can prove codex obeys allow/deny. The shipped product
// remains notify-only; this file lives in scripts/ and is never packaged.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

// Read codex's hook stdin (JSON) so we behave like a real hook; we don't need
// its contents for the decision, but draining stdin avoids a broken pipe.
try { fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }

// Fire the real product notification (best-effort; must not block the decision).
try {
  spawnSync(process.execPath, [NOTIFY, '--source', 'codex', '--event', 'needs_input'], {
    input: JSON.stringify({ hook_event_name: 'PermissionRequest' }),
    timeout: 8000,
  });
} catch { /* notification is best-effort */ }

const decision = process.env.AAN_TEST_DECISION === 'deny' ? 'deny' : 'allow';
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: decision } },
}) + '\n');
process.exit(0);
