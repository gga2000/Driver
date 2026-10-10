#!/usr/bin/env node
// Prints how an EAS build ended, and on failure the end of its log, into the GitHub run
// (Android test apps workflow, docs/deploy/mobile.md "Test APKs from GitHub"), so nobody has to copy
// an error from expo.dev. Usage: node eas-build-report.mjs <build id> [log lines, default 200]
// Needs EXPO_TOKEN and the eas command; run it from the app's folder. Exits 1 when the build failed.
import { execFileSync } from 'node:child_process';

const [id, linesArg] = process.argv.slice(2);
if (!id) {
  console.error('usage: eas-build-report.mjs <build id> [log lines]');
  process.exit(2);
}
const keep = Number(linesArg) || 200;

const build = JSON.parse(execFileSync('eas', ['build:view', id, '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 }));
console.log(`build ${id}: ${build.status}`);
if (build.artifacts?.buildUrl) console.log('APK ready');
if (build.status !== 'ERRORED' && build.status !== 'CANCELED') process.exit(0);

if (build.error) console.log(`::error title=Expo build ${build.error.errorCode ?? ''}::${build.error.message ?? ''}`);
// Log files are signed links: read them here, print only their text, never the links.
const lines = [];
for (const url of build.logFiles ?? []) {
  const res = await fetch(url);
  if (!res.ok) continue;
  for (const raw of (await res.text()).split('\n')) {
    if (!raw.trim()) continue;
    try {
      const entry = JSON.parse(raw);
      lines.push(entry.phase ? `[${entry.phase}] ${entry.msg ?? ''}` : String(entry.msg ?? raw));
    } catch {
      lines.push(raw);
    }
  }
}
const flagged = lines.slice(0, -keep).filter((l) => /error|failed|exception/i.test(l)).slice(-60);
if (flagged.length) console.log(`--- earlier lines that mention an error ---\n${flagged.join('\n')}`);
console.log(`--- last ${Math.min(keep, lines.length)} of ${lines.length} log lines ---`);
console.log(lines.slice(-keep).join('\n'));
process.exit(1);
