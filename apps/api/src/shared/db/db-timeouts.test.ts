import { describe, expect, it } from 'vitest';
import { runAsBackground, runWithRequestId, workKind } from '../request-context.js';
import { dbTimeoutsFromEnv } from './prisma.service.js';

describe('dbTimeoutsFromEnv', () => {
  it('defaults to 5 s for requests and 2 minutes for background work', () => {
    expect(dbTimeoutsFromEnv({})).toEqual({ request: 5_000, background: 120_000 });
  });

  it('reads both limits; 0 turns one off', () => {
    expect(dbTimeoutsFromEnv({ DATABASE_STATEMENT_TIMEOUT_MS: '3000', DATABASE_JOB_STATEMENT_TIMEOUT_MS: '0' })).toEqual({ request: 3_000, background: 0 });
  });

  it('refuses a value that is not whole milliseconds instead of silently running without a limit', () => {
    expect(() => dbTimeoutsFromEnv({ DATABASE_STATEMENT_TIMEOUT_MS: '5s' })).toThrow(/DATABASE_STATEMENT_TIMEOUT_MS must be a whole number/);
    expect(() => dbTimeoutsFromEnv({ DATABASE_JOB_STATEMENT_TIMEOUT_MS: '-1' })).toThrow(/DATABASE_JOB_STATEMENT_TIMEOUT_MS/);
  });
});

describe('workKind', () => {
  it('is request only while serving an HTTP request; jobs, deliveries and sweeps are background', async () => {
    expect(workKind()).toBe('background');
    await runWithRequestId('r1', async () => {
      expect(workKind()).toBe('request');
      await Promise.resolve();
      expect(workKind()).toBe('request');
      // An outbox drain a request's commit started runs as background work.
      expect(runAsBackground('outbox-drain', () => workKind())).toBe('background');
    });
    expect(runAsBackground('job-orders-reject-1', () => workKind())).toBe('background');
  });
});
