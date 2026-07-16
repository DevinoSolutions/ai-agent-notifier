// tests/extract-changelog.test.mjs — the release-notes extractor slices exactly
// one version section out of CHANGELOG.md. Pure function, no I/O.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSection } from '../scripts/extract-changelog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const changelog = fs.readFileSync(path.join(here, '..', 'CHANGELOG.md'), 'utf8');

const SAMPLE = [
  '# Changelog',
  '',
  '## [2.0.0] — 2026-08-01',
  '',
  '### Added',
  '- second thing',
  '',
  '## [1.0.0] — 2026-01-01',
  '',
  '### Added',
  '- first thing',
  '',
].join('\n');

describe('extractSection', () => {
  it('returns the body of the requested version, heading excluded', () => {
    const out = extractSection(SAMPLE, '2.0.0');
    assert.equal(out, '### Added\n- second thing');
  });

  it('stops at the next version heading (no bleed-through)', () => {
    const out = extractSection(SAMPLE, '2.0.0');
    assert.ok(!out.includes('first thing'), 'must not include the older section');
  });

  it('extracts the last section with no trailing heading', () => {
    const out = extractSection(SAMPLE, '1.0.0');
    assert.equal(out, '### Added\n- first thing');
  });

  it('returns null for a version with no section', () => {
    assert.equal(extractSection(SAMPLE, '9.9.9'), null);
  });

  it('does not partial-match a version prefix', () => {
    // Asking for 1.0 must not match the [1.0.0] heading.
    assert.equal(extractSection(SAMPLE, '1.0'), null);
  });

  it('finds the current package version in the real CHANGELOG.md', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'),
    );
    const out = extractSection(changelog, pkg.version);
    assert.ok(out && out.length > 0, `CHANGELOG.md is missing a [${pkg.version}] section`);
  });
});
