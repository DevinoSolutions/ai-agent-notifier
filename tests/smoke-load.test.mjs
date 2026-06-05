// tests/smoke-load.test.mjs — offline unit tests for the smoke-load harness
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasConfigError, classifySmoke } from '../scripts/smoke-load.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(__dirname, 'fixtures', 'fake-cli.mjs');
const PATTERNS = ['failed to parse', 'duplicate key', 'invalid config', 'syntax error'];

describe('hasConfigError', () => {
  it('matches known config-error patterns case-insensitively', () => {
    assert.equal(hasConfigError('Error: Failed To Parse config', PATTERNS), true);
    assert.equal(hasConfigError('fake-cli 1.0.0', PATTERNS), false);
  });
});

describe('classifySmoke', () => {
  it('fail when the valid-config run errors', () => {
    const pos = { status: 1, stdout: '', stderr: 'failed to parse' };
    const neg = { status: 1, stdout: '', stderr: 'failed to parse' };
    assert.equal(classifySmoke(pos, neg, PATTERNS), 'fail');
  });
  it('verified when valid is clean and corrupt errors', () => {
    const pos = { status: 0, stdout: 'ok', stderr: '' };
    const neg = { status: 1, stdout: '', stderr: 'duplicate key' };
    assert.equal(classifySmoke(pos, neg, PATTERNS), 'verified');
  });
  it('launch-only when corrupt also passes', () => {
    const pos = { status: 0, stdout: 'ok', stderr: '' };
    const neg = { status: 0, stdout: 'ok', stderr: '' };
    assert.equal(classifySmoke(pos, neg, PATTERNS), 'launch-only');
  });
});

describe('end-to-end against the fixture CLI', () => {
  const run = (configBody, env = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-fix-'));
    const cfg = path.join(home, 'cfg');
    fs.writeFileSync(cfg, configBody);
    const res = spawnSync(process.execPath, [FAKE], {
      encoding: 'utf8', env: { ...process.env, FAKE_CLI_CONFIG: cfg, ...env },
    });
    fs.rmSync(home, { recursive: true, force: true });
    return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  };

  it('classifies a config-reading CLI as verified', () => {
    const pos = run('valid config');
    const neg = run('BREAK');
    assert.equal(classifySmoke(pos, neg, PATTERNS), 'verified');
  });

  it('classifies a config-ignoring CLI as launch-only', () => {
    const pos = run('valid config', { FAKE_CLI_IGNORE_CONFIG: '1' });
    const neg = run('BREAK', { FAKE_CLI_IGNORE_CONFIG: '1' });
    assert.equal(classifySmoke(pos, neg, PATTERNS), 'launch-only');
  });
});
