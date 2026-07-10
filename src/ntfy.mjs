import https from 'node:https';
import http from 'node:http';
import { logHookError } from './error-log.mjs';

export function buildNtfyRequest(ntfyConfig, notification) {
  const server = (ntfyConfig.server || 'https://ntfy.sh').replace(/\/+$/, '');
  const url = `${server}/${ntfyConfig.topic}`;

  const headers = {
    Title: notification.title,
    Priority: notification.priority || 'default',
  };

  if (notification.ntfyTags) headers.Tags = notification.ntfyTags;
  if (notification.icon) headers.Icon = notification.icon;
  else if (ntfyConfig.icon) headers.Icon = ntfyConfig.icon;
  if (ntfyConfig.click) headers.Click = ntfyConfig.click;

  return { url, headers, body: notification.message };
}

export function sendNtfy(ntfyConfig, notification) {
  return new Promise((resolve) => {
    if (!ntfyConfig.topic) {
      logHookError('ntfy', new Error('ntfy is enabled but no topic is configured'));
      resolve(false);
      return;
    }

    const { url, headers, body } = buildNtfyRequest(ntfyConfig, notification);
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.request(parsed, {
      method: 'POST',
      agent: false, // no keep-alive socket may outlive the hook's process.exit() (see sentry.mjs)
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
      timeout: 5000,
    }, (res) => {
      res.resume(); // drain
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      if (!ok) logHookError('ntfy', new Error(`ntfy server responded ${res.statusCode}`), { url: parsed.origin });
      resolve(ok);
    });

    req.on('error', (err) => {
      logHookError('ntfy', err, { url: parsed.origin });
      resolve(false);
    });
    req.on('timeout', () => {
      req.destroy();
      logHookError('ntfy', new Error('ntfy request timed out after 5000ms'), { url: parsed.origin });
      resolve(false);
    });
    req.end(body);
  });
}
