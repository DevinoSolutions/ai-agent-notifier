// tests/notify-rich.test.mjs — wire-level proof for F3. Spawns the REAL
// notify.mjs against a hermetic local HTTP server standing in for ntfy.sh and
// asserts the exact request BODY: the assistant's transcript text only when the
// user opts in (ntfy.richContent=true), and the generic message otherwise —
// which is the privacy default that keeps conversation text off public topics.
//
// Uses async spawn (not spawnSync) on purpose: the parent event loop must stay
// free to service the child's HTTP request while it runs.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRUB = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'CURSOR_API_KEY', 'NTFY_TOKEN'];

// A single assistant text line whose sanitized form is byte-identical to the
// source (single spaces, no newlines), so we can assert the exact ntfy body.
const RICH_TEXT = 'All checks passed and the build is green.';

function writeTranscript(home) {
  const p = path.join(home, 'transcript.jsonl');
  fs.writeFileSync(p, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'ship it' } }),
    JSON.stringify({
      type: 'assistant', isSidechain: false,
      message: { role: 'assistant', content: [{ type: 'text', text: RICH_TEXT }] },
    }),
  ].join('\n') + '\n');
  return p;
}

function mkHome(ntfyConfig) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-notify-rich-'));
  const cfgDir = path.join(home, '.anotifier');
  fs.mkdirSync(cfgDir, { recursive: true });
  // Only ntfy is live; toast and bell are off so the run is deterministic.
  fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({
    toast: { enabled: false },
    terminalBell: { enabled: false },
    ntfy: ntfyConfig,
  }));
  return home;
}

function runNotify(home, input) {
  return new Promise((resolve) => {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    for (const k of SCRUB) delete env[k];
    const child = spawn(process.execPath, ['src/notify.mjs', '--source', 'claude'], { cwd: repoRoot, env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ status: code, stdout, stderr }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

describe('notify.mjs rich content on the ntfy wire (F3)', () => {
  let server, base, lastBody;

  before(async () => {
    await new Promise((resolve) => {
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => { lastBody = body; res.statusCode = 200; res.end('ok'); });
      });
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('ntfy.richContent=true puts the assistant transcript text in the ntfy body', async () => {
    lastBody = null;
    const home = mkHome({ enabled: true, topic: 't', server: base, richContent: true });
    const transcript = writeTranscript(home);
    const res = await runNotify(home, JSON.stringify({
      hook_event_name: 'Stop', cwd: '/work/app', session_id: 'rich1', transcript_path: transcript,
    }));
    fs.rmSync(home, { recursive: true, force: true });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(lastBody, RICH_TEXT);
  });

  it('ntfy.richContent unset keeps the generic body (public-topic privacy default)', async () => {
    lastBody = null;
    const home = mkHome({ enabled: true, topic: 't', server: base });
    const transcript = writeTranscript(home);
    const res = await runNotify(home, JSON.stringify({
      hook_event_name: 'Stop', cwd: '/work/app', session_id: 'rich2', transcript_path: transcript,
    }));
    fs.rmSync(home, { recursive: true, force: true });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(lastBody, 'app: Task complete');
  });
});
