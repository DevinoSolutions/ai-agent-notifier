// src/parse-input.mjs

const EVENT_MAP = {
  claude: {
    Stop: 'task_complete',
    Notification: 'needs_input',
    SessionStart: 'session_start',
  },
  codex: {
    Stop: 'task_complete',
    PermissionRequest: 'needs_input',
    SessionStart: 'session_start',
  },
  gemini: {
    AfterAgent: 'task_complete',
    Notification: 'needs_input',
    SessionStart: 'session_start',
  },
  cursor: {
    stop: 'task_complete',
    sessionEnd: 'task_complete',
    subagentStop: 'task_complete',
  },
};

export function parseInput(raw, source, eventOverride) {
  // --event CLI arg takes priority (used by Codex/Cursor which don't send hook_event_name on stdin).
  // Claude and Gemini include hook_event_name in stdin JSON.
  const hookEvent = eventOverride || raw.hook_event_name || raw.hookEventName || '';
  const cwd = raw.cwd || '';
  const map = EVENT_MAP[source] || {};

  return {
    source,
    event: map[hookEvent] || 'unknown',
    cwd,
    projectName: cwd ? (cwd.split(/[\\/]/).filter(Boolean).pop() || '') : '',
    sessionId: raw.session_id || raw.sessionId || '',
    // Kept even when unmapped: the hook logs unrecognized events by this name
    // so misconfigured wiring (or a tool's new event type) is visible in
    // errors.log instead of vanishing.
    rawEvent: hookEvent,
  };
}
