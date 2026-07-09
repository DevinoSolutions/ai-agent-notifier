const EVENT_MESSAGES = {
  task_complete: 'Task complete',
  needs_input: 'Needs your input',
  session_start: 'Session started',
};

// Build the canonical notification object every channel consumes.
// `priority` uses the ntfy 5-level scale (min|low|default|high|urgent) as the
// app-wide scale: ntfy sends it verbatim, the Linux backend maps it to
// notify-send urgency. `toastSound` is only honored by desktop toast backends.
export function route(event, config) {
  const messageTemplate = EVENT_MESSAGES[event.event];
  if (!messageTemplate) return null;

  const eventConfig = config.events?.[event.event] || {};
  const sourceConfig = config.sources?.[event.source] || {};
  const label = sourceConfig.label || event.source;
  const prefix = event.projectName ? `${event.projectName}: ` : '';

  return {
    title: label,
    message: `${prefix}${messageTemplate}`,
    toastSound: eventConfig.toastSound || 'Default',
    priority: eventConfig.priority || 'default',
    ntfyTags: eventConfig.ntfyTags || '',
    icon: sourceConfig.icon || '',
    clickToFocus: config.toast?.clickToFocus !== false,
    event: event.event,
    source: event.source,
    projectName: event.projectName,
    cwd: event.cwd,
  };
}
