const EVENT_MESSAGES = {
  task_complete: 'Task complete',
  needs_input: 'Needs your input',
  session_start: 'Session started',
};

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
    sound: eventConfig.sound || 'Default',
    ntfyPriority: eventConfig.ntfyPriority || 'default',
    ntfyTags: eventConfig.ntfyTags || '',
    icon: sourceConfig.icon || '',
    event: event.event,
    source: event.source,
    projectName: event.projectName,
    cwd: event.cwd,
  };
}
