#!/usr/bin/env node
// Publishes an over-the-air update (EAS Update) the safe way (CORE-04):
//
//   node scripts/deploy/eas-update.mjs <customer|partner|merchant> <preview|production> "what changed"
//
// - the channel and the EAS environment are always the same name, so a production update is built
//   with the production server address from expo.dev (never a value typed on this computer);
// - DRIVER_RELEASE=1 makes the app's app.config.js refuse the bundle if that address is missing, on
//   this computer or not https (scripts/deploy/release-env.cjs), before anything is uploaded.
// Needs eas-cli (`npm install -g eas-cli`) and `eas login`. docs/deploy/mobile.md has the details.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APPS = ['customer', 'partner', 'merchant'];
const CHANNELS = ['preview', 'production'];

/** The eas-cli arguments for one update; throws on a bad app, channel or message. */
export function updateArgs(app, channel, message) {
  if (!APPS.includes(app)) throw new Error(`app must be one of ${APPS.join(', ')} (got "${app ?? ''}")`);
  if (!CHANNELS.includes(channel)) throw new Error(`channel must be one of ${CHANNELS.join(', ')} (got "${channel ?? ''}")`);
  if (!message?.trim()) throw new Error('say what changed, e.g. "Fix checkout text"');
  return ['update', '--channel', channel, '--environment', channel, '--message', message.trim(), '--non-interactive'];
}

function main() {
  const [app, channel, message] = process.argv.slice(2);
  let args;
  try {
    args = updateArgs(app, channel, message);
  } catch (e) {
    console.error(`✗ ${e.message}\n  usage: node scripts/deploy/eas-update.mjs <${APPS.join('|')}> <${CHANNELS.join('|')}> "what changed"`);
    process.exit(2);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const cwd = join(root, 'apps', app);
  if (!existsSync(join(cwd, 'app.config.js'))) {
    console.error(`✗ apps/${app}/app.config.js is missing: it is what checks the server address`);
    process.exit(1);
  }
  // A value typed on this computer must not win over the EAS environment's.
  const env = { ...process.env, DRIVER_RELEASE: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('EXPO_PUBLIC_')) delete env[k];
  console.log(`→ apps/${app}: eas ${args.join(' ')}`);
  const r = spawnSync('eas', args, { cwd, env, stdio: 'inherit' });
  if (r.error) {
    console.error(`✗ could not run eas (${r.error.message}); install it with: npm install -g eas-cli`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
