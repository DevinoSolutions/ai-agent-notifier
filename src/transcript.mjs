// src/transcript.mjs — Turn a Claude Code session transcript into a one-line
// notification body ("what the agent actually said") and decide, per channel,
// whether that richer text is allowed to replace the generic message.
//
// Privacy is the whole point of the per-channel split: toast (local screen) and
// webhook (the user's own endpoint) default to rich; ntfy defaults to generic
// because ntfy.sh topics are public and guessable, so conversation text must
// never leak there unless the user explicitly opts in.
import fs from 'node:fs';

// Collapse every run of whitespace (including the newlines that fill a
// transcript block) to a single space, trim, and cap the length with a trailing
// ellipsis. Shared by BOTH the transcript reader and the raw Claude
// notification message so neither can push newlines or quotes into a toast
// argv (native PowerShell or WSL) — the sanitizer is the single choke point.
export function sanitizeNotificationText(text, maxChars = 180) {
  const collapsed = String(text).replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  // Keep the total length (ellipsis included) within the cap.
  return collapsed.slice(0, maxChars - 1).trimEnd() + '…';
}

// Read the newest assistant text block from a Claude Code transcript JSONL,
// sanitized and ready to display, or null when nothing usable is found.
//
// A missing or unreadable transcript is the NORMAL case here — a needs_input
// event may carry no path, and the file can simply not exist yet — so every
// failure resolves to null with NO logHookError. The caller falls back to the
// generic notification; this is not an error worth surfacing in `status`.
export function readLastAssistantText(transcriptPath, { maxBytes = 65536, maxChars = 180 } = {}) {
  if (!transcriptPath) return null;
  let fd;
  try {
    const size = fs.statSync(transcriptPath).size;
    if (size === 0) return null;

    // Tail only the final maxBytes: a long session's transcript can be many MB,
    // and the last assistant message is always near the end.
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buf = Buffer.allocUnsafe(length);
    fd = fs.openSync(transcriptPath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, length, start);
    let lines = buf.toString('utf8', 0, bytesRead).split('\n');

    // When we started mid-file the first line is a fragment of a larger JSON
    // object; drop it so it can't be mistaken for a malformed record. (A '\n'
    // byte can't appear inside a UTF-8 multibyte sequence, so the line split is
    // always safe even if the tail begins mid-character.)
    if (start > 0) lines = lines.slice(1);

    // Reverse-scan for the newest complete assistant text line. The LAST line
    // may ALSO be a partial write (the transcript can be mid-append while this
    // hook fires), which is exactly why every line is parsed inside try/catch —
    // do NOT "optimize" this into trusting the final line.
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i];
      if (!raw || !raw.trim()) continue;
      let obj;
      try { obj = JSON.parse(raw); } catch { continue; }
      // Skip sidechain (subagent) turns and any line without a text block —
      // thinking/tool_use-only assistant turns carry no user-facing words.
      if (!obj || obj.type !== 'assistant' || obj.isSidechain) continue;
      const content = obj.message && obj.message.content;
      if (!Array.isArray(content)) continue;
      const block = content.find(
        (b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim(),
      );
      if (!block) continue;
      return sanitizeNotificationText(block.text, maxChars);
    }
    return null;
  } catch {
    // Missing/unreadable/oversized — all normal, all non-fatal, all → null.
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

// Decide the message each channel should send. Returns { toast, ntfy, webhook },
// each being either the shared generic `notification` or a rich clone whose
// `message` is the assistant's actual words. Pure and side-effect-free apart
// from the injected `readFn` (defaults to the real transcript reader; tests pass
// a stub) so it can be unit-tested without touching the filesystem.
//
// The per-channel enabled checks below intentionally MIRROR the dispatch gates
// in notify.mjs; they live here only to skip the transcript read (and its I/O
// latency) entirely when no rich-capable channel is actually listening.
export function deriveRichViews(event, config, eventConfig, notification, readFn = readLastAssistantText) {
  const views = { toast: notification, ntfy: notification, webhook: notification };

  // Rich content is a Claude-only feature and never applies to session_start
  // (a brand-new session has nothing meaningful to quote).
  if (event.source !== 'claude' || event.event === 'session_start') return views;

  const toastEnabled = config.toast?.enabled !== false && eventConfig.toastEnabled !== false;
  const ntfyEnabled = Boolean(config.ntfy?.enabled && config.ntfy?.topic) && eventConfig.ntfyEnabled !== false;
  const webhookEnabled = Boolean(config.webhook?.enabled && config.webhook?.url) && eventConfig.webhookEnabled !== false;

  const toastRich = toastEnabled && config.toast?.richContent !== false; // local: default ON
  const ntfyRich = ntfyEnabled && config.ntfy?.richContent === true;      // public: default OFF
  const webhookRich = webhookEnabled && config.webhook?.richContent !== false; // own endpoint: default ON

  // No rich-capable channel wants it → don't pay the transcript-read latency.
  if (!toastRich && !ntfyRich && !webhookRich) return views;

  // needs_input carries Claude's own notification text (event.message); use it
  // when present, else fall back to the transcript. task_complete has no such
  // message, so it always reads the transcript. readFn already returns
  // sanitized text; event.message is sanitized here so both paths are equal.
  let richText;
  if (event.event === 'needs_input' && event.message) {
    richText = sanitizeNotificationText(event.message);
  } else {
    richText = readFn(event.transcriptPath) || '';
  }

  // Nothing usable derived → every channel keeps the generic notification.
  if (!richText) return views;

  const richView = { ...notification, message: richText };
  if (toastRich) views.toast = richView;
  if (ntfyRich) views.ntfy = richView;
  if (webhookRich) views.webhook = richView;
  return views;
}
