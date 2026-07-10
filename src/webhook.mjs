// src/webhook.mjs — Deliver notifications to an arbitrary HTTP endpoint, with
// presets for Slack, Discord, and Telegram. Zero-dependency (node:http/https),
// same resolve-false-never-throw contract as the other channels.
//
// SECURITY: the webhook URL is a secret. Slack/Discord webhook URLs embed an
// unguessable token and the Telegram endpoint carries the bot token in its
// path, so failures are logged with the URL ORIGIN ONLY — never the full URL,
// headers, or body — because errors.log can be mirrored to Sentry.
import https from 'node:https';
import http from 'node:http';
import { logHookError } from './error-log.mjs';

// ntfy-parity 5s (not sentry.mjs's 1.5s): a webhook is a primary channel, not
// an observability mirror. Worst-case wall clock stays under the 10s hook budget.
const SEND_TIMEOUT_MS = 5000;

// Pure request builder: maps the canonical notification onto the body shape the
// chosen endpoint expects. Returns { url, headers, body } like buildNtfyRequest.
export function buildWebhookRequest(webhookConfig, notification) {
  const { title, message } = notification;
  const format = webhookConfig.format || 'generic';

  let payload;
  if (format === 'slack') {
    payload = { text: `*${title}*\n${message}` };
  } else if (format === 'discord') {
    payload = { content: `**${title}**\n${message}` };
  } else if (format === 'telegram') {
    payload = { chat_id: webhookConfig.chatId, text: `${title}\n${message}` };
  } else {
    payload = {
      title,
      message,
      source: notification.source,
      project: notification.projectName,
      event: notification.event,
      timestamp: new Date().toISOString(),
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (webhookConfig.authorization) headers.Authorization = webhookConfig.authorization;

  return { url: webhookConfig.url, headers, body: JSON.stringify(payload) };
}

// Fire one webhook. Resolves true on 2xx, false on everything else (no URL,
// unparseable URL, network error, timeout, non-2xx). Never throws — a webhook
// failure must not take down the notification path or the host agent.
// timeoutMs defaults to the 5s contract; overridable only so tests can exercise
// the timeout branch deterministically.
export function sendWebhook(webhookConfig, notification, { timeoutMs = SEND_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    if (!webhookConfig.url) {
      logHookError('webhook', new Error('webhook is enabled but no url is configured'));
      resolve(false);
      return;
    }

    const { url, headers, body } = buildWebhookRequest(webhookConfig, notification);

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      // Never surface the offending value — a malformed webhook URL is still a secret.
      logHookError('webhook', new Error('webhook url is not a valid URL'));
      resolve(false);
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : http;

    // transport.request throws SYNCHRONOUSLY (not via 'error') on a non-http(s)
    // protocol that still parses as a URL (ftp://…) and on invalid header chars
    // (CRLF in authorization) — either would reject this promise and break the
    // never-throws contract, so the whole request setup is guarded.
    try {
      const req = transport.request(parsed, {
        method: 'POST',
        agent: false, // no keep-alive socket may outlive the hook's process.exit() (see sentry.mjs)
        headers,
        timeout: timeoutMs,
      }, (res) => {
        res.resume(); // drain
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        if (!ok) logHookError('webhook', new Error(`webhook endpoint responded ${res.statusCode}`), { url: parsed.origin });
        resolve(ok);
      });

      req.on('error', (err) => {
        logHookError('webhook', err, { url: parsed.origin });
        resolve(false);
      });
      req.on('timeout', () => {
        req.destroy();
        logHookError('webhook', new Error(`webhook request timed out after ${timeoutMs}ms`), { url: parsed.origin });
        resolve(false);
      });
      req.end(body);
    } catch (err) {
      // err.message for these node errors names the protocol/header, never the URL value.
      logHookError('webhook', err, { url: parsed.origin });
      resolve(false);
    }
  });
}
