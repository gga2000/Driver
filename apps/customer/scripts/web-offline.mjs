#!/usr/bin/env node
// Offline and new versions for the customer website (speed idea w6, docs/deploy/vercel.md). Runs after
// `expo export --platform web`, before scripts/deploy/prepare-web.mjs (which copies index.html into
// invite.html, so both pages carry the version):
//
//   node apps/customer/scripts/web-offline.mjs apps/customer/dist-web
//
// - names this version: the first 12 hex of the SHA-256 of the exported index.html (it lists the
//   hashed bundles, so any code change gives a new name) and writes it into the page
//   (<meta name="driver-build">) and into /version.json, which the open app reads to notice a newer
//   version (src/lib/web-build.ts);
// - writes /sw.js from web/sw.js with that name and the files to keep for offline: everything the page
//   loads first (shell) plus every screen's bundle under 300 KB (the map library is left to load when a
//   map is opened);
// - WEB_OFFLINE=off (or --off) writes a worker that deletes its caches and unregisters itself instead,
//   and leaves the page without the offline switch: the way back if the worker ever misbehaves.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Screen bundles above this are left to load on first use (the map library is ~1 MB). */
export const SCREEN_MAX_BYTES = 300_000;

const OFF_WORKER = `/* Offline switched off (WEB_OFFLINE=off): this worker removes itself and what the old one kept. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith('driver-')) await caches.delete(name);
      await self.registration.unregister();
    })(),
  );
});
`;

/**
 * @param {string} dir the export folder (has index.html)
 * @param {{ enabled?: boolean }} [options]
 * @returns {{ build: string, precache: { url: string, shell: boolean }[] }}
 */
export function prepareOffline(dir, { enabled = true } = {}) {
  const root = resolve(dir);
  const indexPath = join(root, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`${indexPath} not found: run the web export first`);
  const html = readFileSync(indexPath, 'utf8');
  if (html.includes('name="driver-build"'))
    throw new Error('index.html already has a version: run this once per export');
  const build = createHash('sha256').update(html).digest('hex').slice(0, 12);

  const shell = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/(?:_expo\/static|assets)\/[^"]+)"/g)].map((m) => m[1]),
    ),
  ];
  for (const url of shell)
    if (!existsSync(join(root, url)))
      throw new Error(`index.html loads ${url}, which is not in the export`);
  const jsDir = join(root, '_expo/static/js/web');
  const screens = existsSync(jsDir)
    ? readdirSync(jsDir)
        .filter((f) => f.endsWith('.js') && statSync(join(jsDir, f)).size <= SCREEN_MAX_BYTES)
        .map((f) => `/${relative(root, join(jsDir, f)).split('\\').join('/')}`)
        .filter((url) => !shell.includes(url))
        .sort()
    : [];
  const precache = [
    ...shell.map((url) => ({ url, shell: true })),
    ...screens.map((url) => ({ url, shell: false })),
  ];

  const metas = [
    `<meta name="driver-build" content="${build}" />`,
    ...(enabled ? ['<meta name="driver-offline" content="on" />'] : []),
  ];
  writeFileSync(indexPath, html.replace('</head>', `  ${metas.join('\n    ')}\n  </head>`));
  writeFileSync(join(root, 'version.json'), `${JSON.stringify({ build })}\n`);
  const template = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');
  const worker = template
    .replace("'%BUILD%'", JSON.stringify(build))
    .replace('/* %PRECACHE% */ []', JSON.stringify(precache));
  if (enabled && (worker.includes('%BUILD%') || worker.includes('%PRECACHE%')))
    throw new Error('web/sw.js lost its placeholders');
  writeFileSync(join(root, 'sw.js'), enabled ? worker : OFF_WORKER);
  return { build, precache };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('usage: node apps/customer/scripts/web-offline.mjs <dist-web folder> [--off]');
    process.exit(2);
  }
  const enabled = !(process.argv.includes('--off') || process.env.WEB_OFFLINE === 'off');
  const { build, precache } = prepareOffline(dir, { enabled });
  const kb = Math.round(
    precache.reduce((s, f) => s + statSync(join(resolve(dir), f.url)).size, 0) / 1024,
  );
  console.log(
    enabled
      ? `✔ version ${build}: sw.js keeps ${precache.length} files (${kb} KB before compression) for offline`
      : `✔ version ${build}: offline OFF, sw.js removes itself from every phone that had it`,
  );
}
