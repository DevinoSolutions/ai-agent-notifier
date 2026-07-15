// scripts/lib/ocr-nonce.mjs — nonce generation + OCR normalization for the
// Linux render proof (scripts/live-toast-linux-render.mjs). Pure logic, no I/O,
// so the same rules are unit-testable on every OS (including Windows, where
// tesseract is absent). The render proof reads a notification's text back off
// the framebuffer with tesseract; these helpers make that read reliable and its
// match unambiguous.

// OCR-safe alphabet: excludes the glyph pairs tesseract most often confuses at
// banner sizes — 0/O, 1/I/L, 5/S, 8/B, 2/Z, and 9 (which tesseract read as `S`
// on a real render, Actions run 29394142374). The remaining digits 3 4 6 7 are
// each empirically confirmed to OCR correctly at DejaVu Sans Mono 26 (runs
// 29391999880 and 29394142374). What remains is A–Z + 3 4 6 7 after removing the
// ambiguous glyphs.
export const OCR_SAFE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY3467';

// Characters deliberately kept OUT of the alphabet, for the no-ambiguity test.
export const OCR_EXCLUDED = '0O1IL5S8B2Z9';

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
