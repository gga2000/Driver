import { describe, expect, it } from 'vitest';
import { describePrismaError, prismaErrorLogger } from './db/prisma-error-log.js';
import { AppLogger } from './logging.js';
import {
  currentRequestId,
  requestIdFrom,
  requestIdMiddleware,
  runWithRequestId,
} from './request-context.js';

describe('request context', () => {
  it('keeps the id across awaits and only inside the run', async () => {
    expect(currentRequestId()).toBeUndefined();
    await runWithRequestId('e2e-sos-1', async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(currentRequestId()).toBe('e2e-sos-1');
    });
    expect(currentRequestId()).toBeUndefined();
  });

  it('accepts a sane header, replaces anything else with a uuid', () => {
    expect(requestIdFrom('e2e-food-42')).toBe('e2e-food-42');
    expect(requestIdFrom(['e2e-a', 'e2e-b'])).toBe('e2e-a');
    for (const bad of [undefined, '', 'a b', 'x'.repeat(129), '{"json":1}'])
      expect(requestIdFrom(bad)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('middleware echoes the id and runs the rest of the chain inside it', () => {
    const headers: Record<string, string> = {};
    let seen: string | undefined;
    requestIdMiddleware(
      { headers: { 'x-request-id': 'e2e-ride-7' } },
      { setHeader: (k, v) => void (headers[k] = v) },
      () => void (seen = currentRequestId()),
    );
    expect(headers['x-request-id']).toBe('e2e-ride-7');
    expect(seen).toBe('e2e-ride-7');
  });

  it('the json logger stamps requestId inside a request and not outside', () => {
    const lines: Array<Record<string, unknown>> = [];
    const logger = new AppLogger(
      'json',
      undefined,
      ['error', 'warn', 'log'],
      (l) => void lines.push(JSON.parse(l) as Record<string, unknown>),
    );
    runWithRequestId('e2e-share-9', () => logger.error('boom', 'X'));
    logger.log('idle', 'X');
    expect(lines[0]).toMatchObject({ level: 'error', msg: 'boom', requestId: 'e2e-share-9' });
    expect(lines[1]).not.toHaveProperty('requestId');
  });
});

describe('Prisma error log', () => {
  it('logs a failed query once and rethrows the same error', async () => {
    const logged: string[] = [];
    const hook = prismaErrorLogger((m) => void logged.push(m));
    const fk = Object.assign(
      new Error(
        '\nInvalid `prisma.order.create()` invocation:\n\n\nForeign key constraint violated on the constraint: `orders_quote_id_fkey`',
      ),
      { code: 'P2003' },
    );
    await expect(
      hook({ model: 'Order', operation: 'create', args: {}, query: () => Promise.reject(fk) }),
    ).rejects.toBe(fk);
    expect(logged).toEqual([
      'prisma P2003 on Order.create: Foreign key constraint violated on the constraint: `orders_quote_id_fkey`',
    ]);
    await expect(
      hook({ operation: '$queryRaw', args: {}, query: () => Promise.resolve(1) }),
    ).resolves.toBe(1);
    expect(logged).toHaveLength(1);
  });

  it('falls back to the driver adapter code, then to unknown', () => {
    const raw = Object.assign(new Error('current transaction is aborted'), {
      meta: { driverAdapterError: { cause: { originalCode: '25P02' } } },
    });
    expect(describePrismaError(raw, undefined, '$executeRaw')).toBe(
      'prisma 25P02 on $executeRaw: current transaction is aborted',
    );
    expect(describePrismaError('weird', 'X', 'findMany')).toBe(
      'prisma unknown on X.findMany: weird',
    );
  });
});
