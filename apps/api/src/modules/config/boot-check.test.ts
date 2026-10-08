import { describe, expect, it } from 'vitest';
import { assertBootConfig, bootConfigProblems, deployEnvironmentFromEnv } from './boot-check.js';

const base = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x' };
const live = { ...base, SMS_PROVIDER: 'http', PUSH_PROVIDER: 'expo' };

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

  it('needs real SMS and Expo push in production, and no staging test code', () => {
    expect(bootConfigProblems(live)).toEqual([]);
    expect(bootConfigProblems({ ...base, EXPO_ACCESS_TOKEN: 't', SMS_PROVIDER: 'twilio' })).toEqual([]);
    const problems = bootConfigProblems({ ...base, SMS_PROVIDER: 'dev', PUSH_PROVIDER: 'dev', STAGING_TEST_OTP: '123456' });
    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).toMatch(/SMS_PROVIDER.*PUSH_PROVIDER.*STAGING_TEST_OTP/);
    expect(bootConfigProblems({ ...base })).toHaveLength(2);
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
