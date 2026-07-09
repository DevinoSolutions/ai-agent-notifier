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

// ── Gradient Text (internal — used by banner) ───────────────────────
function gradient(text, from, to) {
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

// ── Strip ANSI (internal — for width calculation) ───────────────────
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ── Simple color logger ─────────────────────────────────────────────
// Shared by the setup and config wizards so they format output identically.
const LOG_COLORS = {
  green: c.green, cyan: c.cyan, yellow: c.yellow, red: c.red,
  dim: c.dim, bold: c.bold, white: c.white, muted: c.muted,
};

export function log(msg, color = '') {
  const fn = LOG_COLORS[color];
  console.log(fn ? fn(msg) : msg);
}

// ── readline prompts ────────────────────────────────────────────────
// Shared by setup and config. Both resolve if the input stream closes (EOF /
// non-TTY / Ctrl+D) instead of hanging forever on a pending question. The close
// guard is skipped for readline shims that don't expose an event emitter
// (setup's pre-collected-stdin shim).
export function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const suffix = defaultVal ? ` (${defaultVal})` : '';
    let done = false;
    const onClose = () => finish('');
    const finish = (answer) => {
      if (done) return;
      done = true;
      if (typeof rl.removeListener === 'function') rl.removeListener('close', onClose);
      resolve((answer ?? '').trim() || defaultVal || '');
    };
    rl.question(`  ? ${question}${suffix}: `, finish);
    if (typeof rl.on === 'function') rl.on('close', onClose);
  });
}

export function askYN(rl, question, defaultYes = true) {
  return new Promise((resolve) => {
    const hint = defaultYes ? '(Y/n)' : '(y/N)';
    let done = false;
    const onClose = () => finish('');
    const finish = (answer) => {
      if (done) return;
      done = true;
      if (typeof rl.removeListener === 'function') rl.removeListener('close', onClose);
      const a = (answer ?? '').trim().toLowerCase();
      if (!a) { resolve(defaultYes); return; }
      resolve(a === 'y' || a === 'yes');
    };
    rl.question(`  ? ${question} ${hint}: `, finish);
    if (typeof rl.on === 'function') rl.on('close', onClose);
  });
}

// ── Box Drawing ─────────────────────────────────────────────────────
const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', lj: '├', rj: '┤' };

export function box(lines, { padding = 1, borderColor = c.muted, width = 0 } = {}) {
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

// ── Spinner ─────────────────────────────────────────────────────────
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

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
      stream.write(`\r  ${color('✓')} ${finalMessage}\x1b[K\n`);
    },
    warn(finalMessage) {
      stopped = true;
      clearInterval(timer);
      stream.write(`\r  ${c.warn('⚠')} ${finalMessage}\x1b[K\n`);
    },
    fail(finalMessage) {
      stopped = true;
      clearInterval(timer);
      stream.write(`\r  ${c.error('✗')} ${finalMessage}\x1b[K\n`);
    },
  };
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
  return c.brand(`▸ ${title}`);
}
