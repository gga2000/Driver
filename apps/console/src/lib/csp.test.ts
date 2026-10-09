import { describe, expect, it } from 'vitest';
import { RTL_TEXT_PLUGIN_URL } from '@driver/map';
import { buildCsp, makeNonce } from './csp';

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
