import { describe, expect, it } from 'vitest';
import { assertBootConfig, bootConfigProblems, bootConfigWarnings, deployEnvironmentFromEnv } from './boot-check.js';
import { testLaunchedVerticals } from './config.service.js';

const base = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x' };
const LINKS = {
  CONSOLE_BASE_URL: 'https://console.example.com',
  SAFETY_LINK_BASE_URL: 'https://app.example.com/sos/',
  SHARE_LINK_BASE_URL: 'https://app.example.com',
  NOTIFY_RECEIPT_BASE_URL: 'https://app.example.com/r/',
};
const LINK_NAMES = Object.keys(LINKS) as Array<keyof typeof LINKS>;
const REQUIRED_LINKS = LINK_NAMES.filter((n) => n !== 'NOTIFY_RECEIPT_BASE_URL');
const live = { ...base, ...LINKS, SMS_PROVIDER: 'http' };

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
    expect(bootConfigProblems({ ...base, ...LINKS, SMS_PROVIDER: 'twilio' })).toEqual([]);
    const problems = bootConfigProblems({ ...base, ...LINKS, SMS_PROVIDER: 'dev', STAGING_TEST_OTP: '123456' });
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).toMatch(/SMS_PROVIDER.*STAGING_TEST_OTP/);
    expect(bootConfigProblems({ ...base, ...LINKS })).toHaveLength(1);
  });

  it('refuses production without each required address we put in messages; staging only warns', () => {
    for (const name of REQUIRED_LINKS) {
      const others = Object.fromEntries(Object.entries(LINKS).filter(([k]) => k !== name));
      const prod = { ...base, ...others, SMS_PROVIDER: 'http' };
      expect(bootConfigProblems(prod), name).toEqual([expect.stringMatching(new RegExp(`^${name} is not set`))]);
      expect(() => assertBootConfig(prod)).toThrow(new RegExp(`refusing to boot \\(production\\): ${name} is not set`));
      expect(bootConfigWarnings(prod)).toEqual([]);
      const staging = { ...base, ...others, DEPLOY_ENVIRONMENT: 'staging' };
      expect(bootConfigProblems(staging)).toEqual([]);
      expect(bootConfigWarnings(staging)).toEqual([expect.stringMatching(new RegExp(`^${name} is not set`))]);
    }
    expect(bootConfigWarnings({ ...base, DEPLOY_ENVIRONMENT: 'staging' })).toHaveLength(4);
    expect(bootConfigWarnings({ ...base, SMS_PROVIDER: 'http' })).toEqual([expect.stringMatching(/^NOTIFY_RECEIPT_BASE_URL is not set/)]);
    expect(bootConfigWarnings({ ...base, ...LINKS, DEPLOY_ENVIRONMENT: 'staging' })).toEqual([]);
    expect(bootConfigWarnings({})).toEqual([]);
  });

  it('never requires the receipt address (no page serves receipts yet): production and staging only warn', () => {
    const { NOTIFY_RECEIPT_BASE_URL: receipt, ...others } = LINKS;
    expect(receipt).toBeTruthy();
    for (const env of [{ ...base, ...others, SMS_PROVIDER: 'http' }, { ...base, ...others, DEPLOY_ENVIRONMENT: 'staging' }]) {
      expect(bootConfigProblems(env)).toEqual([]);
      expect(() => assertBootConfig(env)).not.toThrow();
      expect(bootConfigWarnings(env)).toEqual([expect.stringMatching(/^NOTIFY_RECEIPT_BASE_URL is not set/)]);
    }
    expect(bootConfigWarnings(live)).toEqual([]);
  });

  it('refuses an address that is not public https, on staging and production, without echoing it', () => {
    const bad = ['http://app.example.com', 'https://localhost:3100', 'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.20', 'https://172.20.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://driver-console.internal', 'https://console.local', 'not a url', 'https://user:pw@app.example.com'];
    for (const name of LINK_NAMES) {
      for (const value of bad) {
        for (const env of [live, { ...base, ...LINKS, DEPLOY_ENVIRONMENT: 'staging' }]) {
          const problems = bootConfigProblems({ ...env, [name]: value });
          expect(problems, `${name}=${value}`).toHaveLength(1);
          expect(problems[0]).toMatch(new RegExp(`^${name} `));
          expect(problems[0]).not.toContain(value);
        }
      }
    }
    expect(bootConfigProblems({ ...live, CONSOLE_BASE_URL: 'https://console.example.com/' })).toEqual([]);
    expect(bootConfigProblems({ ...live, SHARE_LINK_BASE_URL: 'https://172.32.0.1' })).toEqual([]);
  });

  it('keeps the launch scope on every deployed server: the test override is local only', () => {
    const open = { DRIVER_TEST_LAUNCHED_VERTICALS: 'food,taxi,tuktuk,intercity,khat' };
    expect(bootConfigProblems({ ...live, ...open })).toEqual([expect.stringMatching(/DRIVER_TEST_LAUNCHED_VERTICALS is for local runs and CI only/)]);
    expect(bootConfigProblems({ ...base, DEPLOY_ENVIRONMENT: 'staging', ...open })).toHaveLength(1);
    expect(testLaunchedVerticals({ NODE_ENV: 'test', ...open })).toEqual(['food', 'taxi', 'tuktuk', 'intercity', 'khat']);
    expect(testLaunchedVerticals({ ...live, ...open })).toBeNull();
    expect(testLaunchedVerticals({ NODE_ENV: 'test' })).toBeNull();
    expect(() => testLaunchedVerticals({ NODE_ENV: 'test', DRIVER_TEST_LAUNCHED_VERTICALS: 'food,boats' })).toThrow();
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
