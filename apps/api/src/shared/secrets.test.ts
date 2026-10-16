import { describe, expect, it } from 'vitest';
import { linkSecretFromEnv, MIN_SECRET_LENGTH } from './secrets.js';

const strong = (c: string) => c.repeat(MIN_SECRET_LENGTH);

describe('link secrets (SEC-15)', () => {
  it('production refuses to boot without its own strong value', () => {
    const env = { NODE_ENV: 'production', JWT_SECRET: strong('j') };
    expect(() => linkSecretFromEnv(env, 'SHARE_LINK_SECRET')).toThrow(/SHARE_LINK_SECRET is required/);
    expect(() => linkSecretFromEnv({ ...env, SHARE_LINK_SECRET: 'short' }, 'SHARE_LINK_SECRET')).toThrow(/at least 32/);
    expect(linkSecretFromEnv({ ...env, SHARE_LINK_SECRET: strong('s') }, 'SHARE_LINK_SECRET')).toBe(strong('s'));
  });

  it('production refuses a link secret equal to JWT_SECRET or to another link kind', () => {
    const env = { NODE_ENV: 'production', JWT_SECRET: strong('j'), SHARE_LINK_SECRET: strong('s') };
    expect(() => linkSecretFromEnv({ ...env, SHARE_LINK_SECRET: strong('j') }, 'SHARE_LINK_SECRET')).toThrow(/must differ from JWT_SECRET/);
    expect(() => linkSecretFromEnv({ ...env, SAFETY_LINK_SECRET: strong('s') }, 'SAFETY_LINK_SECRET', { distinctFrom: ['SHARE_LINK_SECRET'] })).toThrow(/must differ from SHARE_LINK_SECRET/);
    expect(linkSecretFromEnv({ ...env, SAFETY_LINK_SECRET: strong('o') }, 'SAFETY_LINK_SECRET', { distinctFrom: ['SHARE_LINK_SECRET'] })).toBe(strong('o'));
  });

  it('outside production it falls back in order, then to a random value per boot', () => {
    expect(linkSecretFromEnv({ JWT_SECRET: 'jwt' }, 'SAFETY_LINK_SECRET', { fallbacks: ['SHARE_LINK_SECRET', 'JWT_SECRET'] })).toBe('jwt');
    expect(linkSecretFromEnv({ JWT_SECRET: 'jwt', SHARE_LINK_SECRET: 'share' }, 'SAFETY_LINK_SECRET', { fallbacks: ['SHARE_LINK_SECRET', 'JWT_SECRET'] })).toBe('share');
    const a = linkSecretFromEnv({}, 'SHARE_LINK_SECRET');
    expect(a).toHaveLength(64);
    expect(linkSecretFromEnv({}, 'SHARE_LINK_SECRET')).not.toBe(a);
  });
});
