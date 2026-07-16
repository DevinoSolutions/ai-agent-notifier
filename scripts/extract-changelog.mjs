#!/usr/bin/env node
// Print the CHANGELOG.md section for a single version, for use as a GitHub
// release body. Usage: node scripts/extract-changelog.mjs 1.2.1
//
// Finds the `## [<version>]` heading and prints every line under it up to (but
// not including) the next `## [` heading. Exits non-zero if the version has no
// section, so the release job fails loudly rather than publishing empty notes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export function extractSection(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  // Match `## [1.2.1]` — the bracketed version at the start of an h2 heading.
  const isHeading = (line) => /^##\s+\[/.test(line);
  const target = `## [${version}]`;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(target)) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeading(lines[i])) {
      end = i;
      break;
    }
  }
  // Drop the heading line itself and trim surrounding blank lines.
  return lines.slice(start + 1, end).join('\n').trim();
}

function main() {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: extract-changelog.mjs <version>');
    process.exit(2);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const changelogPath = join(here, '..', 'CHANGELOG.md');
  const md = readFileSync(changelogPath, 'utf8');
  const section = extractSection(md, version);
  if (section === null || section.length === 0) {
    console.error(`no CHANGELOG.md section found for version ${version}`);
    process.exit(1);
  }
  process.stdout.write(section + '\n');
}

// Run only when invoked directly, not when imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
