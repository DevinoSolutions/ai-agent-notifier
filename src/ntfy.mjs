import https from 'node:https';
import http from 'node:http';

export function buildNtfyRequest(ntfyConfig, notification) {
  const server = (ntfyConfig.server || 'https://ntfy.sh').replace(/\/+$/, '');
  const url = `${server}/${ntfyConfig.topic}`;

  const headers = {
    Title: notification.title,
    Priority: notification.ntfyPriority || 'default',
  };

  if (notification.ntfyTags) headers.Tags = notification.ntfyTags;
  if (notification.icon) headers.Icon = notification.icon;
  else if (ntfyConfig.icon) headers.Icon = ntfyConfig.icon;
  if (ntfyConfig.click) headers.Click = ntfyConfig.click;

  return { url, headers, body: notification.message };
}

export function sendNtfy(ntfyConfig, notification) {
  return new Promise((resolve) => {
    if (!ntfyConfig.topic) { resolve(false); return; }

    const { url, headers, body } = buildNtfyRequest(ntfyConfig, notification);
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.request(parsed, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
      timeout: 5000,
    }, (res) => {
      res.resume(); // drain
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end(body);
  });
}
