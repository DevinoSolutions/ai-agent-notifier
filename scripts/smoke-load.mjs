// scripts/smoke-load.mjs — launch a real agent CLI against a valid vs corrupt
// config and classify whether it loads our patched config cleanly.
//
// Usage: node scripts/smoke-load.mjs --cli <claude|codex|gemini|cursor> [--require-verified]
// Exit 0 on 'verified' or 'launch-only' (or SKIP when the CLI is absent);
// exit 1 on 'fail', or on non-'verified' when --require-verified is set.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchClaude, patchCodex, patchCursor, patchGemini } from '../setup/patch-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const NOTIFY = path.join(repoRoot, 'src', 'notify.mjs');

export function hasConfigError(text, patterns) {
  const t = String(text || '').toLowerCase();
  return patterns.some((p) => t.includes(p.toLowerCase()));
}

// 'fail'        valid-config run errored (real breakage)
// 'verified'    valid clean AND corrupt errored (probe truly parses config)
// 'launch-only' valid clean BUT corrupt also clean (only proved the CLI launches)
export function classifySmoke(positive, negative, patterns) {
  const posClean = positive.status === 0 && !hasConfigError(positive.stderr + positive.stdout, patterns);
  if (!posClean) return 'fail';
  const negErrored = negative.status !== 0 || hasConfigError(negative.stderr + negative.stdout, patterns);
  return negErrored ? 'verified' : 'launch-only';
}

const PATTERNS = ['failed to parse', 'duplicate key', 'invalid config', 'syntax error', 'could not parse', 'unexpected'];

const CLIS = {
  claude: { bin: 'claude', args: ['--version'], dir: '.claude', patch: patchClaude,
    corrupt: (home) => fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{ BREAK not json') },
  codex: { bin: 'codex', args: ['--version'], dir: '.codex', patch: patchCodex,
    corrupt: (home) => fs.writeFileSync(path.join(home, '.codex', 'config.toml'),
      "[hooks.state.'a']\nx = 1\n[hooks.state.'a']\nx = 2\n# BREAK duplicate key\n") },
  gemini: { bin: 'gemini', args: ['--version'], dir: '.gemini', patch: patchGemini,
    corrupt: (home) => fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), '{ BREAK not json') },
  cursor: { bin: 'cursor-agent', args: ['--version'], dir: '.cursor', patch: patchCursor,
    corrupt: (home) => fs.writeFileSync(path.join(home, '.cursor', 'hooks.json'), '{ BREAK not json') },
};

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aan-smoke-'));
}

function runCli(spec, home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const res = spawnSync(spec.bin, spec.args, { encoding: 'utf8', env, timeout: 60000 });
  return res; // res.error set (ENOENT) if the binary is missing
}

function main() {
  const argv = process.argv.slice(2);
  const cli = argv[argv.indexOf('--cli') + 1];
  const requireVerified = argv.includes('--require-verified');
  const spec = CLIS[cli];
  if (!spec) { console.error(`Unknown --cli "${cli}"`); process.exit(2); }

  // Positive: a valid patched config.
  const posHome = freshHome();
  fs.mkdirSync(path.join(posHome, spec.dir), { recursive: true });
  if (spec.dir === '.claude') fs.writeFileSync(path.join(posHome, '.claude', 'settings.json'), '{}\n');
  if (spec.dir === '.gemini') fs.writeFileSync(path.join(posHome, '.gemini', 'settings.json'), '{}\n');
  spec.patch(path.join(posHome, spec.dir), NOTIFY);
  const pos = runCli(spec, posHome);

  if (pos.error && pos.error.code === 'ENOENT') {
    console.log(`SKIP ${cli}: "${spec.bin}" is not installed on this runner.`);
    fs.rmSync(posHome, { recursive: true, force: true });
    process.exit(0);
  }

  // Negative: a deliberately corrupt config.
  const negHome = freshHome();
  fs.mkdirSync(path.join(negHome, spec.dir), { recursive: true });
  spec.corrupt(negHome);
  const neg = runCli(spec, negHome);

  const norm = (r) => ({ status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' });
  const verdict = classifySmoke(norm(pos), norm(neg), PATTERNS);
  console.log(`${cli}: ${verdict}`);
  console.log(`  positive: exit=${pos.status} ${(pos.stderr || pos.stdout || '').trim().split('\n')[0]}`);
  console.log(`  negative: exit=${neg.status} ${(neg.stderr || neg.stdout || '').trim().split('\n')[0]}`);

  fs.rmSync(posHome, { recursive: true, force: true });
  fs.rmSync(negHome, { recursive: true, force: true });

  if (verdict === 'fail') process.exit(1);
  if (requireVerified && verdict !== 'verified') {
    console.error(`  expected 'verified' for ${cli} but got '${verdict}'`);
    process.exit(1);
  }
  process.exit(0);
}

// Only run main when invoked directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
