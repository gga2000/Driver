import { describe, expect, it } from 'vitest';
import { hoursIgnored } from './staging-always-open.js';

describe('hoursIgnored (test version: every restaurant open at any hour)', () => {
  it('is on only on staging, and STAGING_KEEP_HOURS=1 turns it off there', () => {
    expect(hoursIgnored({ NODE_ENV: 'production', DEPLOY_ENVIRONMENT: 'staging' })).toBe(true);
    expect(hoursIgnored({ NODE_ENV: 'production', DEPLOY_ENVIRONMENT: 'staging', STAGING_KEEP_HOURS: '1' })).toBe(false);
    expect(hoursIgnored({ NODE_ENV: 'production' })).toBe(false);
    expect(hoursIgnored({ NODE_ENV: 'production', DEPLOY_ENVIRONMENT: 'production' })).toBe(false);
    expect(hoursIgnored({ NODE_ENV: 'test', DEPLOY_ENVIRONMENT: 'staging' })).toBe(false);
  });
});
