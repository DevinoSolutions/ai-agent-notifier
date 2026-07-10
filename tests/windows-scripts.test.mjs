// tests/windows-scripts.test.mjs — guards the Windows PowerShell assets.
// The parse-clean checks are Windows-gated: they need pwsh and skip cleanly
// elsewhere (or when pwsh is absent). The ClickToFocus regression pin is a static
// file read and runs on every platform, so dropping the param fails CI anywhere.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN_DIR = path.join(repoRoot, 'assets', 'windows');
const SCRIPTS = ['toast.ps1', 'bell.ps1', 'focus-window.ps1', 'toast-wsl.ps1'];

// True only when a usable pwsh is on PATH (spawn succeeds). Lets the parse checks
// skip cleanly on runners without PowerShell 7 installed.
function pwshAvailable() {
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

// Extract the leading param(...) block by matching balanced parentheses so a
// nested [Parameter(...)] attribute inside the block does not truncate the match.
function paramBlock(src) {
  const start = src.indexOf('param(');
  if (start === -1) return null;
  let depth = 0;
  for (let i = src.indexOf('(', start); i < src.length; i++) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

describe('assets/windows/*.ps1 parse clean (Windows + pwsh only)', () => {
  const isWindows = os.platform() === 'win32';
  const havePwsh = isWindows && pwshAvailable();

  for (const name of SCRIPTS) {
    it(`${name} has no PowerShell parse errors`, (t) => {
      if (!isWindows) return t.skip('not Windows');
      if (!havePwsh) return t.skip('pwsh not available');
      const abs = path.join(WIN_DIR, name);
      // Parse the file with the PS language parser; any ParseError -> exit 1.
      const psCmd = `$errs = $null; [System.Management.Automation.Language.Parser]::ParseFile('${abs}', [ref]$null, [ref]$errs) | Out-Null; if ($errs -and $errs.Count) { $errs | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }`;
      const res = spawnSync('pwsh', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8' });
      assert.equal(res.status, 0, `${name} failed to parse:\n${res.stderr || res.stdout}`);
    });
  }
});

describe('assets/windows/toast.ps1 regression pins', () => {
  it('declares the ClickToFocus param (all platforms — static read)', () => {
    const src = fs.readFileSync(path.join(WIN_DIR, 'toast.ps1'), 'utf8');
    const block = paramBlock(src);
    assert.ok(block, 'toast.ps1 must open with a param(...) block');
    assert.match(block, /ClickToFocus/, 'toast.ps1 param block must declare ClickToFocus');
  });
});
