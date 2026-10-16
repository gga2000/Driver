import { describe, expect, it } from 'vitest';
import { RTL_TEXT_PLUGIN_URL } from '@driver/map';
import { buildCsp, makeNonce, UPLOADS_FALLBACK } from './csp';

const parse = (csp: string) => Object.fromEntries(csp.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));

describe('Console CSP (CON-06)', () => {
  it('runs only its own scripts and the nonce, in production', () => {
    const p = parse(buildCsp({ nonce: 'abc', apiUrl: 'https://api.driver.iq/trpc', dev: false }));
    expect(p['script-src']).toEqual(["'self'", "'nonce-abc'", RTL_TEXT_PLUGIN_URL]);
    // The map's one script is pinned to its file; no host-wide source may sneak back in. It is moving
    // from unpkg to our own map bucket (self-hosted by platform); either exact file is fine meanwhile.
    expect(RTL_TEXT_PLUGIN_URL).toMatch(
      /^https:\/\/(unpkg\.com\/@mapbox\/mapbox-gl-rtl-text@[\d.]+\/dist\/[\w.-]+|lapigvjdsuapfexzdcvl\.supabase\.co\/storage\/v1\/object\/public\/map\/plugins\/mapbox-gl-rtl-text-[\d.]+)\.js$/,
    );
    for (const src of p['script-src']!.slice(2)) expect(src).not.toMatch(/^https:\/\/[^/]+\/?$/);
    expect(p['script-src']).not.toContain("'unsafe-inline'");
    expect(p['script-src']).not.toContain("'unsafe-eval'");
    expect(p['object-src']).toEqual(["'none'"]);
    expect(p['frame-ancestors']).toEqual(["'none'"]);
    expect(p['connect-src']).toContain('https://api.driver.iq');
    expect(p['base-uri']).toEqual(["'self'"]);
  });

  it('sends only to the API, the map hosts and the crash reports, never any https host', () => {
    const p = parse(
      buildCsp({
        nonce: 'n',
        apiUrl: 'https://api.driver.iq/trpc',
        dev: false,
        mapUrls: ['pmtiles://https://maps.driver.iq/wasit.pmtiles', 'https://maps.driver.iq/fonts/{fontstack}/{range}.pbf', undefined, 'not a url'],
        crashDsn: 'https://key@o1.ingest.sentry.io/2',
        uploadsOrigin: 'https://abcdefghijkl.storage.supabase.co',
      }),
    );
    expect(p['connect-src']).not.toContain('https:');
    expect(p['connect-src']).toEqual([
      "'self'",
      'https://api.driver.iq',
      'https://tile.openstreetmap.org',
      'https://protomaps.github.io',
      new URL(RTL_TEXT_PLUGIN_URL).origin,
      'https://maps.driver.iq',
      'https://o1.ingest.sentry.io',
      'https://abcdefghijkl.storage.supabase.co',
    ]);
  });

  it('uploads: the exact origin when set (a path is cut off), Supabase Storage until it is', () => {
    const set = parse(buildCsp({ nonce: 'n', apiUrl: 'https://api.driver.iq/trpc', dev: false, uploadsOrigin: 'https://abcdefghijkl.storage.supabase.co/storage/v1/s3' }));
    expect(set['connect-src']).toContain('https://abcdefghijkl.storage.supabase.co');
    expect(set['connect-src']).not.toContain(UPLOADS_FALLBACK);
    const unset = parse(buildCsp({ nonce: 'n', apiUrl: 'https://api.driver.iq/trpc', dev: false }));
    expect(unset['connect-src']).toContain('https://*.storage.supabase.co');
    expect(unset['connect-src']).not.toContain('https:');
  });

  it('dev: no uploads fallback; the local API and localhost as before', () => {
    const p = parse(buildCsp({ nonce: 'n', apiUrl: 'http://localhost:3395/trpc', dev: true }));
    expect(p['connect-src']).not.toContain(UPLOADS_FALLBACK);
    expect(p['connect-src']).toEqual(expect.arrayContaining(["'self'", 'http://localhost:3395', 'ws:', 'http://localhost:*']));
  });

  it('lets next dev hot-reload and the local studio frame it', () => {
    const p = parse(buildCsp({ nonce: 'n', apiUrl: 'http://localhost:3395/trpc', dev: true }));
    expect(p['script-src']).toContain("'unsafe-eval'");
    expect(p['connect-src']).toEqual(expect.arrayContaining(['http://localhost:3395', 'ws:']));
    expect(p['frame-ancestors']).toEqual(["'self'", 'http://localhost:4000']);
  });

  it('makes a fresh 128-bit nonce each time', () => {
    const a = makeNonce();
    expect(atob(a)).toHaveLength(16);
    expect(makeNonce()).not.toBe(a);
  });
});
