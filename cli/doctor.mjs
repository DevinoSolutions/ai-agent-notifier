// cli/doctor.mjs — `anotifier doctor`: per-channel delivery self-check.
// Flags: --deep (send a real marker toast + verify via NC DB on macOS),
//        --json (machine output for CI), --strict (deep warns become fails;
//        also enabled by AAN_DOCTOR_STRICT=1).
import os from 'node:os';
import { loadConfigResult } from '../src/config-loader.mjs';
import { runChecks } from './doctor-checks.mjs';
import { c } from './ui.mjs';

const ICON = { ok: c.success('✓'), warn: c.warn('⚠'), fail: c.error('✗'), info: c.accent('ℹ') };

export async function run(...args) {
  const flags = new Set(args.filter(Boolean));
  const deep = flags.has('--deep');
  const json = flags.has('--json');
  const strict = flags.has('--strict') || process.env.AAN_DOCTOR_STRICT === '1';

  const { config, problem } = loadConfigResult();
  const results = await runChecks({ config, configProblem: problem, deep, strict });

  if (json) {
    process.stdout.write(JSON.stringify({ platform: os.platform(), deep, strict, checks: results }, null, 2) + '\n');
  } else {
    console.log();
    console.log(`  ${c.bold('anotifier')} ${c.accent('doctor')}${deep ? c.muted(' --deep') : ''}`);
    console.log();
    for (const r of results) {
      const line = `  ${ICON[r.status]} ${c.white((r.channel + ':').padEnd(9))} ${r.detail}`;
      console.log(line);
      if (r.hint) console.log(`      ${c.muted('↳ ' + r.hint)}`);
    }
    console.log();
  }

  // Exit non-zero if any check failed (warns are allowed). CLI strict at the edge.
  if (results.some((r) => r.status === 'fail')) process.exitCode = 1;
}
