#!/usr/bin/env node
/**
 * App size budget (speed audit g3): exports each phone app for Android the way an update ships it
 * (Hermes bytecode) and checks the code and the pictures/sounds/fonts inside against budgets.json.
 * Google found every extra 6 MB loses about 1 % of installs, more in markets like ours.
 *
 *   pnpm build                       # packages first (the apps import their dist)
 *   node scripts/perf/size.mjs       # all three apps; APPS=customer to pick
 *
 * Note: exported with --source-maps, as EAS does. Without it Hermes keeps extra debug data in the file
 * (8.3 MB instead of 6.9 MB for the customer app), which is not what phones download.
 */
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { judge, report } from './lib.mjs';

const root = resolve(import.meta.dirname, '../..');
const budgets = JSON.parse(readFileSync(join(import.meta.dirname, 'budgets.json'), 'utf8')).size;
const apps = (process.env.APPS ?? 'customer,partner,merchant').split(',');
const mb = (bytes) => Math.round(bytes / 10_000) / 100;
const total = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .reduce((s, e) => s + statSync(join(e.parentPath, e.name)).size, 0);

const measured = {};
for (const app of apps) {
  const out = mkdtempSync(join(tmpdir(), `size-${app}-`));
  execFileSync(
    'npx',
    ['expo', 'export', '--platform', 'android', '--source-maps', '--clear', '--output-dir', out],
    {
      cwd: join(root, 'apps', app),
      env: { ...process.env, EXPO_OFFLINE: '1', CI: '1' },
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  const js = join(out, '_expo', 'static', 'js', 'android');
  measured[`${app}.code_mb`] = mb(
    readdirSync(js)
      .filter((f) => f.endsWith('.hbc'))
      .reduce((s, f) => s + statSync(join(js, f)).size, 0),
  );
  measured[`${app}.assets_mb`] = mb(total(join(out, 'assets')));
  rmSync(out, { recursive: true, force: true });
}

const result = judge(
  Object.fromEntries(
    Object.entries(budgets).filter(([k]) => apps.some((a) => k.startsWith(`${a}.`))),
  ),
  measured,
);
const md = report(
  'App size (Android, MB)',
  result,
  Object.fromEntries(Object.keys(measured).map((k) => [k, ' MB'])),
);
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(measured, null, 1));
if (!result.ok) {
  console.error(
    'Over the size budget. If the growth is worth it, raise the number in scripts/perf/budgets.json in the same PR and say why.',
  );
  process.exit(1);
}
