import { describe, expect, it } from 'vitest';
import { corsOriginFromEnv } from './bootstrap.js';

describe('CORS_ORIGINS', () => {
  it('unset: any origin (development, and until the web domains exist)', () => {
    expect(corsOriginFromEnv({})).toBe(true);
    expect(corsOriginFromEnv({ CORS_ORIGINS: ' , ' })).toBe(true);
  });

  it('a comma-separated list, trimmed, without trailing slashes', () => {
    expect(corsOriginFromEnv({ CORS_ORIGINS: 'https://app.driver.iq/, https://console.driver.iq' })).toEqual(['https://app.driver.iq', 'https://console.driver.iq']);
  });
});
