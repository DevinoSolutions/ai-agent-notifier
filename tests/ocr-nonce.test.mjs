// tests/ocr-nonce.test.mjs — strict, pure-logic tests for the render-proof nonce
// helpers. No tesseract, no display, no I/O — so these pass identically on
// Windows (where the Linux render proof itself can't run). They pin the three
// properties the proof depends on: the alphabet excludes OCR-ambiguous glyphs,
// normalization is whitespace-insensitive + uppercasing, and matching is a
// normalized substring test (never full-string equality).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OCR_SAFE_ALPHABET,
  OCR_EXCLUDED,
  OCR_NOT_YET_OBSERVED,
  generateNonce,
  normalizeOcr,
  ocrContainsNonce,
} from '../scripts/lib/ocr-nonce.mjs';

describe('OCR_SAFE_ALPHABET — observed-correct glyphs only', () => {
  it('is exactly the set observed OCR-correct on real renders', () => {
    // Pinning the exact string enforces the policy: a char enters only with a
    // captured render proving it reads back. Changing this without such a
    // capture should break this test on purpose.
    assert.equal(OCR_SAFE_ALPHABET, 'ACDEGHMNPRTUVWY3467');
  });

  it('contains none of the known-confusable characters 0 O 1 I L 5 S 8 B 2 Z 9', () => {
    for (const ch of OCR_EXCLUDED) {
      assert.ok(!OCR_SAFE_ALPHABET.includes(ch), `alphabet must not contain "${ch}"`);
    }
  });

  it('excludes 9 specifically (tesseract read it as S on a real render)', () => {
    assert.ok(!OCR_SAFE_ALPHABET.includes('9'), 'alphabet must not contain "9"');
  });

  it('excludes F J K Q X — not yet observed OCR-correct on a real render', () => {
    // These are held out because no capture has proven them (not because they
    // are known-confusable). A static banner misreads systematically, so an
    // unverified glyph is an unacceptable random-red risk on a gating check.
    for (const ch of OCR_NOT_YET_OBSERVED) {
      assert.ok(!OCR_SAFE_ALPHABET.includes(ch), `alphabet must not contain unobserved "${ch}"`);
    }
  });

  it('is drawn only from uppercase letters and the confirmed-safe digits 3 4 6 7', () => {
    assert.match(OCR_SAFE_ALPHABET, /^[A-Z3467]+$/);
  });

  it('has no duplicate characters', () => {
    assert.equal(new Set(OCR_SAFE_ALPHABET).size, OCR_SAFE_ALPHABET.length);
  });
});

describe('generateNonce', () => {
  it('defaults to length 10', () => {
    assert.equal(generateNonce().length, 10);
  });

  it('honors an explicit length', () => {
    assert.equal(generateNonce(16).length, 16);
  });

  it('only ever draws characters from the OCR-safe alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const nonce = generateNonce();
      for (const ch of nonce) {
        assert.ok(OCR_SAFE_ALPHABET.includes(ch), `nonce char "${ch}" not in OCR-safe alphabet`);
      }
    }
  });

  it('never emits an excluded character across many draws', () => {
    for (let i = 0; i < 200; i++) {
      const nonce = generateNonce(12);
      for (const ch of OCR_EXCLUDED) {
        assert.ok(!nonce.includes(ch), `nonce leaked excluded char "${ch}"`);
      }
    }
  });
});

describe('normalizeOcr', () => {
  it('strips all whitespace (spaces, tabs, newlines)', () => {
    assert.equal(normalizeOcr('AB CD\tEF\nGH'), 'ABCDEFGH');
  });

  it('uppercases lowercase input', () => {
    assert.equal(normalizeOcr('render gadnnm36rw'), 'RENDERGADNNM36RW');
  });

  it('returns empty string for null/undefined/empty', () => {
    assert.equal(normalizeOcr(null), '');
    assert.equal(normalizeOcr(undefined), '');
    assert.equal(normalizeOcr(''), '');
  });
});

describe('ocrContainsNonce — the render-proof gate', () => {
  it('matches when the nonce sits inside surrounding banner text', () => {
    // Mirrors real tesseract output: a stray icon-glyph char, the title line,
    // then the body line carrying the nonce.
    const ocr = 'g AI Agent Notifier\nRENDER GADNNM36RW\n';
    assert.equal(ocrContainsNonce(ocr, 'GADNNM36RW'), true);
  });

  it('matches across OCR-inserted whitespace inside the nonce', () => {
    assert.equal(ocrContainsNonce('RENDER GAD NNM 36RW', 'GADNNM36RW'), true);
  });

  it('is case-insensitive', () => {
    assert.equal(ocrContainsNonce('render gadnnm36rw', 'GADNNM36RW'), true);
  });

  it('does NOT match a blank pre-fire frame (no-false-positive guard)', () => {
    assert.equal(ocrContainsNonce('', 'GADNNM36RW'), false);
    assert.equal(ocrContainsNonce('\n \t\n', 'GADNNM36RW'), false);
  });

  it('does NOT match a different nonce', () => {
    assert.equal(ocrContainsNonce('RENDER ACDEFGHJKM', 'GADNNM36RW'), false);
  });

  it('does NOT match when the nonce is empty (guards against vacuous truth)', () => {
    assert.equal(ocrContainsNonce('anything at all', ''), false);
  });
});
