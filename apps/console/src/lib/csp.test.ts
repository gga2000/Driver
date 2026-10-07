import { describe, expect, it } from 'vitest';
import { buildCsp, makeNonce } from './csp';

const parse = (csp: string) => Object.fromEntries(csp.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));

describe('Console CSP (CON-06)', () => {
  it('runs only its own scripts and the nonce, in production', () => {
    const p = parse(buildCsp({ nonce: 'abc', apiUrl: 'https://api.driver.iq/trpc', dev: false }));
    expect(p['script-src']).toEqual(["'self'", "'nonce-abc'", 'https://unpkg.com']);
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
