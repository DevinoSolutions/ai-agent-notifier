// src/parse-input.mjs
import path from 'node:path';

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
    notification: 'needs_input',
  },
};

export function parseInput(raw, source) {
  const hookEvent = raw.hook_event_name || raw.hookEventName || '';
  const cwd = raw.cwd || '';
  const map = EVENT_MAP[source] || {};

  return {
    source,
    event: map[hookEvent] || 'unknown',
    cwd,
    projectName: cwd ? path.basename(cwd) : '',
    sessionId: raw.session_id || raw.sessionId || '',
    rawEvent: hookEvent,
    raw,
  };
}
