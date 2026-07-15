// scripts/lib/ocr-nonce.mjs — nonce generation + OCR normalization for the
// Linux render proof (scripts/live-toast-linux-render.mjs). Pure logic, no I/O,
// so the same rules are unit-testable on every OS (including Windows, where
// tesseract is absent). The render proof reads a notification's text back off
// the framebuffer with tesseract; these helpers make that read reliable and its
// match unambiguous.

// OCR-safe alphabet: OBSERVED-CORRECT GLYPHS ONLY. A static banner renders
// identical pixels every frame, so an OCR misread is systematic — the same glyph
// misreads on every frame and the multi-frame retry cannot rescue it. The only
// safe policy for a gating check is therefore: a character may enter this
// alphabet ONLY if it has been captured OCR-reading-back-correctly in a real
// render. Add a new char only with a captured render proving it reads back.
//
// This set is exactly the characters observed correct across the three real
// renders to date (GADNNM36RW, U*NRP7MY4E, 7CNHVTVE3G): A C D E G H M N P R T U
// V W Y and 3 4 6 7. Excluded for two distinct reasons:
//   - confusable and banned outright (OCR_EXCLUDED): 0 O 1 I L 5 S 8 B 2 Z 9;
//   - not yet observed on a real render (F J K Q X): held out until a capture
//     proves them — Q/O in particular is a classic confusable, and O is banned.
export const OCR_SAFE_ALPHABET = 'ACDEGHMNPRTUVWY3467';

// Characters deliberately kept OUT of the alphabet because they are known-
// confusable glyphs, for the no-ambiguity test.
export const OCR_EXCLUDED = '0O1IL5S8B2Z9';

// Characters held out only because they haven't been observed OCR-correct on a
// real render yet (not confirmed confusable). Promote to OCR_SAFE_ALPHABET once
// a captured render proves each reads back.
export const OCR_NOT_YET_OBSERVED = 'FJKQX';

// A random nonce drawn only from the OCR-safe alphabet. Default length 10 keeps
// it short enough to fit one banner line in a large mono font, long enough that
// it can't collide with incidental on-screen text.
export function generateNonce(length = 10) {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += OCR_SAFE_ALPHABET[Math.floor(Math.random() * OCR_SAFE_ALPHABET.length)];
  }
  return s;
}

// Normalize an OCR result for comparison: strip ALL whitespace and uppercase.
// tesseract sprinkles stray spaces/newlines inside and around a banner (and the
// notification icon glyph often decodes to a stray leading character), so a
// whitespace-insensitive substring test is the only reliable match — never a
// full-string equality compare against the raw OCR.
export function normalizeOcr(text) {
  return String(text || '').replace(/\s+/g, '').toUpperCase();
}

// Does the OCR text contain the nonce, after normalizing both sides? This is the
// positive gate and the no-false-positive guard both. Because the alphabet is
// uppercase-only and normalize() uppercases, this is case-insensitive.
export function ocrContainsNonce(ocrText, nonce) {
  const n = normalizeOcr(nonce);
  if (!n) return false;
  return normalizeOcr(ocrText).includes(n);
}
