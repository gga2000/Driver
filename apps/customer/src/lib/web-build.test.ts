import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareOffline, SCREEN_MAX_BYTES } from '../../scripts/web-offline.mjs';
import { isChunkLoadError, isNewer, mayReload } from './web-build';

/** A tiny web export: the page, its three first bundles, a font, two screens and the map library. */
function fakeExport(): string {
  const dir = mkdtempSync(join(tmpdir(), 'web-offline-'));
  mkdirSync(join(dir, '_expo/static/js/web'), { recursive: true });
  mkdirSync(join(dir, 'assets/fonts'), { recursive: true });
  const js = (name: string, bytes = 100) =>
    writeFileSync(join(dir, '_expo/static/js/web', name), 'x'.repeat(bytes));
  js('__expo-metro-runtime-aa.js');
  js('__common-bb.js');
  js('entry-cc.js');
  js('cart-dd.js');
  js('[id]-ee.js');
  js('maplibre-gl-ff.js', SCREEN_MAX_BYTES + 1);
  writeFileSync(join(dir, 'assets/fonts/plex-400.v1.woff2'), 'f');
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html dir="rtl"><head>
    <link rel="preload" href="/assets/fonts/plex-400.v1.woff2" as="font" crossorigin />
    <script src="/_expo/static/js/web/__expo-metro-runtime-aa.js" defer></script>
    <script src="/_expo/static/js/web/__common-bb.js" defer></script>
    <script src="/_expo/static/js/web/entry-cc.js" defer></script>
  </head><body><div id="root"></div></body></html>`,
  );
  return dir;
}

describe('web offline step (scripts/web-offline.mjs)', () => {
  it('names the version in the page and in /version.json', () => {
    const dir = fakeExport();
    const { build } = prepareOffline(dir);
    expect(build).toMatch(/^[0-9a-f]{12}$/);
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(html).toContain(`<meta name="driver-build" content="${build}" />`);
    expect(html).toContain('<meta name="driver-offline" content="on" />');
    expect(html.indexOf('driver-build')).toBeLessThan(html.indexOf('</head>'));
    expect(JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8'))).toEqual({ build });
  });

  it('keeps the shell and the screens for offline, not the map library', () => {
    const dir = fakeExport();
    const { precache } = prepareOffline(dir);
    expect(precache.filter((f) => f.shell).map((f) => f.url)).toEqual([
      '/assets/fonts/plex-400.v1.woff2',
      '/_expo/static/js/web/__expo-metro-runtime-aa.js',
      '/_expo/static/js/web/__common-bb.js',
      '/_expo/static/js/web/entry-cc.js',
    ]);
    expect(precache.filter((f) => !f.shell).map((f) => f.url)).toEqual([
      '/_expo/static/js/web/[id]-ee.js',
      '/_expo/static/js/web/cart-dd.js',
    ]);
  });

  it('writes the worker with this version and its files filled in', () => {
    const dir = fakeExport();
    const { build, precache } = prepareOffline(dir);
    const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
    expect(sw).toContain(`const BUILD = "${build}";`);
    expect(sw).toContain(`const PRECACHE = ${JSON.stringify(precache)};`);
    expect(sw).not.toMatch(/%BUILD%|%PRECACHE%/);
    // Pages always from the network first; the cached page only when it fails.
    expect(sw).toMatch(
      /mode === 'navigate'[\s\S]*fetch\(req\)[\s\S]*catch[\s\S]*caches\.match\(PAGE/,
    );
  });

  it('switched off, ships a worker that removes itself and no offline switch in the page', () => {
    const dir = fakeExport();
    prepareOffline(dir, { enabled: false });
    const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
    expect(sw).toContain('registration.unregister()');
    expect(sw).toContain('caches.delete');
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(html).toContain('name="driver-build"');
    expect(html).not.toContain('driver-offline');
  });

  it('refuses a second run and a page that loads a missing file', () => {
    const dir = fakeExport();
    prepareOffline(dir);
    expect(() => prepareOffline(dir)).toThrow(/once per export/);
    const broken = fakeExport();
    writeFileSync(
      join(broken, 'index.html'),
      '<head><script src="/_expo/static/js/web/gone-00.js"></script></head>',
    );
    expect(() => prepareOffline(broken)).toThrow(/not in the export/);
  });
});

describe('web version check (src/lib/web-build.ts)', () => {
  it('knows a screen whose code did not download', () => {
    const err = Object.assign(
      new Error('Loading module https://x/_expo/static/js/web/cart-1.js failed.\n(error: …)'),
      { name: 'AsyncRequireError' },
    );
    expect(isChunkLoadError(err)).toBe(true);
    expect(isChunkLoadError({ message: 'Loading module /a.js failed.' })).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('only a different, well-formed version counts as newer', () => {
    expect(isNewer('aaaaaaaaaaaa', { build: 'bbbbbbbbbbbb' })).toBe(true);
    expect(isNewer('aaaaaaaaaaaa', { build: 'aaaaaaaaaaaa' })).toBe(false);
    expect(isNewer('aaaaaaaaaaaa', { build: '<html>' })).toBe(false);
    expect(isNewer('aaaaaaaaaaaa', null)).toBe(false);
    expect(isNewer('aaaaaaaaaaaa', '<!doctype html>')).toBe(false);
  });

  it('reloads by itself at most once a minute', () => {
    const now = 1_000_000;
    expect(mayReload(null, now)).toBe(true);
    expect(mayReload(String(now - 5_000), now)).toBe(false);
    expect(mayReload(String(now - 61_000), now)).toBe(true);
    expect(mayReload('junk', now)).toBe(true);
    expect(mayReload(String(now + 60_000), now)).toBe(true);
  });
});
