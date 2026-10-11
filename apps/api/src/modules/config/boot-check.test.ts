import { describe, expect, it } from 'vitest';
import { assertBootConfig, bootConfigProblems, bootConfigWarnings, deployEnvironmentFromEnv } from './boot-check.js';

const base = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x' };
const CONSOLE = { CONSOLE_BASE_URL: 'https://console.example.com' };
const live = { ...base, ...CONSOLE, SMS_PROVIDER: 'http' };

describe('boot configuration (SEC-16)', () => {
  it('asks nothing of a laptop or a test run', () => {
    expect(bootConfigProblems({})).toEqual([]);
    expect(bootConfigProblems({ NODE_ENV: 'test' })).toEqual([]);
  });

  it('tells staging from production, and counts an unset environment as production', () => {
    expect(deployEnvironmentFromEnv({ NODE_ENV: 'production', DEPLOY_ENVIRONMENT: 'staging' })).toBe('staging');
    expect(deployEnvironmentFromEnv({ NODE_ENV: 'production' })).toBe('production');
    expect(deployEnvironmentFromEnv({ NODE_ENV: 'development', DEPLOY_ENVIRONMENT: 'staging' })).toBe('local');
  });

  it('lets staging run with dev SMS and dev push, but not without a database or Redis', () => {
    expect(bootConfigProblems({ ...base, DEPLOY_ENVIRONMENT: 'staging', SMS_PROVIDER: 'fake', STAGING_TEST_OTP: '123456' })).toEqual([]);
    expect(bootConfigProblems({ NODE_ENV: 'production', DEPLOY_ENVIRONMENT: 'staging' })).toEqual(['DATABASE_URL is not set', 'REDIS_URL is not set']);
  });

  it('needs real SMS in production, and no staging test code', () => {
    expect(bootConfigProblems(live)).toEqual([]);
    expect(bootConfigProblems({ ...base, ...CONSOLE, SMS_PROVIDER: 'twilio' })).toEqual([]);
    const problems = bootConfigProblems({ ...base, ...CONSOLE, SMS_PROVIDER: 'dev', STAGING_TEST_OTP: '123456' });
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).toMatch(/SMS_PROVIDER.*STAGING_TEST_OTP/);
    expect(bootConfigProblems({ ...base, ...CONSOLE })).toHaveLength(1);
  });

  it('refuses production without the Console address staff alerts link to; staging only warns', () => {
    expect(bootConfigProblems({ ...base, SMS_PROVIDER: 'http' })).toEqual([expect.stringMatching(/^CONSOLE_BASE_URL is not set/)]);
    expect(() => assertBootConfig({ ...base, SMS_PROVIDER: 'http' })).toThrow(/refusing to boot \(production\): CONSOLE_BASE_URL is not set/);
    expect(bootConfigWarnings({ ...base, SMS_PROVIDER: 'http' })).toEqual([]);
    const staging = { ...base, DEPLOY_ENVIRONMENT: 'staging' };
    expect(bootConfigProblems(staging)).toEqual([]);
    expect(bootConfigWarnings(staging)).toEqual([expect.stringMatching(/^CONSOLE_BASE_URL is not set/)]);
    expect(bootConfigWarnings({ ...staging, ...CONSOLE })).toEqual([]);
    expect(bootConfigWarnings({})).toEqual([]);
  });

  it('refuses a Console address that is not public https, on staging and production, without echoing it', () => {
    for (const value of ['http://console.example.com', 'https://localhost:3100', 'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.20', 'https://172.20.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://driver-console.internal', 'https://console.local', 'not a url', 'https://user:pw@console.example.com']) {
      for (const env of [live, { ...base, DEPLOY_ENVIRONMENT: 'staging' }]) {
        const problems = bootConfigProblems({ ...env, CONSOLE_BASE_URL: value });
        expect(problems, value).toHaveLength(1);
        expect(problems[0]).toMatch(/^CONSOLE_BASE_URL /);
        expect(problems[0]).not.toContain(value);
      }
    }
    expect(bootConfigProblems({ ...live, CONSOLE_BASE_URL: 'https://console.example.com/' })).toEqual([]);
    expect(bootConfigProblems({ ...live, CONSOLE_BASE_URL: 'https://172.32.0.1' })).toEqual([]);
  });

  it('throws the whole list at once and never echoes a value', () => {
    expect(() => assertBootConfig({ NODE_ENV: 'production', STAGING_TEST_OTP: '987654' })).toThrow(/refusing to boot \(production\): DATABASE_URL is not set; REDIS_URL is not set; SMS_PROVIDER/);
    try {
      assertBootConfig({ NODE_ENV: 'production', STAGING_TEST_OTP: '987654' });
    } catch (err) {
      expect((err as Error).message).not.toContain('987654');
    }
    expect(() => assertBootConfig(live)).not.toThrow();
  });
});
