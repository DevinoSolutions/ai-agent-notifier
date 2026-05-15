// cli/ui.mjs — Zero-dependency CLI UI utilities (ANSI + Unicode)

// ── Colors ──────────────────────────────────────────────────────────
const ESC = '\x1b[';
const RESET = `${ESC}0m`;

function rgb(r, g, b) {
  return (text) => `${ESC}38;2;${r};${g};${b}m${text}${RESET}`;
}

function bgRgb(r, g, b) {
  return (text) => `${ESC}48;2;${r};${g};${b}m${text}${RESET}`;
}

export const c = {
  bold:    (t) => `${ESC}1m${t}${RESET}`,
  dim:     (t) => `${ESC}2m${t}${RESET}`,
  italic:  (t) => `${ESC}3m${t}${RESET}`,
  underline: (t) => `${ESC}4m${t}${RESET}`,
  green:   (t) => `${ESC}32m${t}${RESET}`,
  red:     (t) => `${ESC}31m${t}${RESET}`,
  yellow:  (t) => `${ESC}33m${t}${RESET}`,
  cyan:    (t) => `${ESC}36m${t}${RESET}`,
  white:   (t) => `${ESC}37m${t}${RESET}`,
  gray:    (t) => `${ESC}90m${t}${RESET}`,
  // Brand colors
  brand:   rgb(99, 102, 241),   // Indigo
  accent:  rgb(139, 92, 246),   // Purple
  info:    rgb(56, 189, 248),   // Sky blue
  success: rgb(52, 211, 153),   // Emerald
  warn:    rgb(251, 191, 36),   // Amber
  error:   rgb(248, 113, 113),  // Red
  muted:   rgb(148, 163, 184),  // Slate
  rgb,
  bgRgb,
};

// ── Gradient Text ───────────────────────────────────────────────────
export function gradient(text, from, to) {
  const len = text.length;
  if (len === 0) return text;
  return text.split('').map((ch, i) => {
    const t = len === 1 ? 0 : i / (len - 1);
    const r = Math.round(from[0] + (to[0] - from[0]) * t);
    const g = Math.round(from[1] + (to[1] - from[1]) * t);
    const b = Math.round(from[2] + (to[2] - from[2]) * t);
    return `${ESC}38;2;${r};${g};${b}m${ch}`;
  }).join('') + RESET;
}

// ── Strip ANSI (for width calculation) ──────────────────────────────
export function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ── Box Drawing ─────────────────────────────────────────────────────
const BOX = { tl: '\u256d', tr: '\u256e', bl: '\u2570', br: '\u256f', h: '\u2500', v: '\u2502', lj: '\u251c', rj: '\u2524' };

export function box(lines, { padding = 1, borderColor = c.muted, titleColor = c.brand, width = 0 } = {}) {
  const pad = ' '.repeat(padding);
  const maxContent = width || Math.max(...lines.map(l => stripAnsi(l).length));
  const innerWidth = maxContent + padding * 2;

  const top    = borderColor(`${BOX.tl}${BOX.h.repeat(innerWidth)}${BOX.tr}`);
  const bottom = borderColor(`${BOX.bl}${BOX.h.repeat(innerWidth)}${BOX.br}`);
  const sep    = borderColor(`${BOX.lj}${BOX.h.repeat(innerWidth)}${BOX.rj}`);

  const rows = lines.map(line => {
    if (line === '---') return sep;
    const visible = stripAnsi(line).length;
    const fill = ' '.repeat(Math.max(0, maxContent - visible));
    return `${borderColor(BOX.v)}${pad}${line}${fill}${pad}${borderColor(BOX.v)}`;
  });

  return [top, ...rows, bottom].join('\n');
}

// ── Table ───────────────────────────────────────────────────────────
export function table(rows, { gap = 2 } = {}) {
  if (rows.length === 0) return '';
  const cols = rows[0].length;
  const widths = Array(cols).fill(0);
  for (const row of rows) {
    for (let i = 0; i < cols; i++) {
      widths[i] = Math.max(widths[i], stripAnsi(String(row[i] || '')).length);
    }
  }
  return rows.map(row =>
    row.map((cell, i) => {
      const s = String(cell || '');
      const pad = ' '.repeat(Math.max(0, widths[i] - stripAnsi(s).length));
      return s + pad;
    }).join(' '.repeat(gap))
  ).join('\n');
}

// ── Spinner ─────────────────────────────────────────────────────────
const SPINNER_FRAMES = ['', '', '', '', '', '', '', '', '', ''];

export function spinner(message) {
  let i = 0;
  let stopped = false;
  const stream = process.stderr;

  const timer = setInterval(() => {
    if (stopped) return;
    const frame = c.brand(SPINNER_FRAMES[i % SPINNER_FRAMES.length]);
    stream.write(`\r  ${frame} ${c.muted(message)}`);
    i++;
  }, 80);

  return {
    stop(finalMessage, color = c.success) {
      stopped = true;
      clearInterval(timer);
      stream.write(`\r  ${color('\u2713')} ${finalMessage}\x1b[K\n`);
    },
    fail(finalMessage) {
      stopped = true;
      clearInterval(timer);
      stream.write(`\r  ${c.error('\u2717')} ${finalMessage}\x1b[K\n`);
    },
  };
}

// ── Progress Bar ────────────────────────────────────────────────────
export function progressBar(current, total, { width = 30, label = '' } = {}) {
  const pct = Math.min(1, current / total);
  const filled = Math.round(width * pct);
  const empty = width - filled;
  const bar = c.brand('\u2588'.repeat(filled)) + c.muted('\u2591'.repeat(empty));
  const percent = c.white(`${Math.round(pct * 100)}%`);
  const labelStr = label ? `  ${c.muted(label)}` : '';
  return `  ${bar} ${percent}${labelStr}`;
}

// ── Banner ──────────────────────────────────────────────────────────
export function banner() {
  const lines = [
    '    _   ___   _  _     _   _  ___',
    '   /_\\ |_ _| | \\| |___| |_(_)/ _|_  _',
    '  / _ \\ | |  | .` / _ \\  _| |  _| || |',
    ' /_/ \\_\\___|_|_|\\_\\___/\\__|_|_|  \\_, |',
    '              |___|              |__/',
  ];
  const from = [99, 102, 241];   // Indigo
  const to = [139, 92, 246];     // Purple
  return lines.map(line => gradient(line, from, to)).join('\n');
}

// ── Key-Value Line ──────────────────────────────────────────────────
export function kv(key, value, { keyWidth = 14, keyColor = c.muted, valueColor = c.white } = {}) {
  return `${keyColor(key.padEnd(keyWidth))} ${valueColor(value)}`;
}

// ── Section Header ──────────────────────────────────────────────────
export function sectionHeader(title) {
  return c.brand(`\u25b8 ${title}`);
}
