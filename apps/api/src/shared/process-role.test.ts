import { describe, expect, it } from 'vitest';
import { processRoleFromEnv, runsJobs } from './process-role.js';

describe('processRoleFromEnv', () => {
  it('defaults to all, which needs no Redis (today: one process does everything)', () => {
    expect(processRoleFromEnv({})).toBe('all');
    expect(processRoleFromEnv({ DRIVER_ROLE: '' })).toBe('all');
    expect(processRoleFromEnv({ DRIVER_ROLE: 'all' })).toBe('all');
  });

  it('reads web and worker, ignoring case and spaces', () => {
    const redis = { REDIS_URL: 'redis://localhost:6379' };
    expect(processRoleFromEnv({ ...redis, DRIVER_ROLE: 'web' })).toBe('web');
    expect(processRoleFromEnv({ ...redis, DRIVER_ROLE: ' Worker ' })).toBe('worker');
  });

  it('refuses an unknown role instead of silently running everything', () => {
    expect(() => processRoleFromEnv({ DRIVER_ROLE: 'workers' })).toThrow(/DRIVER_ROLE must be one of web, worker, all/);
  });

  it('refuses web or worker without Redis: jobs would be queued where nobody runs them', () => {
    expect(() => processRoleFromEnv({ DRIVER_ROLE: 'web' })).toThrow(/needs REDIS_URL/);
    expect(() => processRoleFromEnv({ DRIVER_ROLE: 'worker' })).toThrow(/needs REDIS_URL/);
  });
});

describe('runsJobs', () => {
  it('is false only for web', () => {
    expect(runsJobs('web')).toBe(false);
    expect(runsJobs('worker')).toBe(true);
    expect(runsJobs('all')).toBe(true);
  });
});
