import { Logger } from '@nestjs/common';
import { NOTIFY_STUCK_AFTER_SEC } from '@driver/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { EventsService } from '../events/index.js';
import type { NotifyLookups } from './notify.lookups.js';
import { NotifyModule, NOTIFY_STUCK_REPEAT_MS } from './notify.module.js';
import { notifyHarness, ScriptedPush } from './test-harness.js';

const SEC = 1000;
const receipt = { merchant: 'مطعم خالد', amount: '12,500', receiptUrl: 'https://app.example.com/r/ord_1', orderId: 'ord_1' };

/** A message whose rows were claimed for a send and then the process died: sentAt set, still queued. */
async function claimedThenDied(h: ReturnType<typeof notifyHarness>, eventId = 'ev1') {
  const rows = await h.service.dispatch({ eventId, template: 'order_receipt', to: 'cust', orderId: 'ord_1', params: receipt });
  for (const r of rows) expect(await h.repo.claimSend(r.id, h.clock.now())).toBe(true);
  return rows;
}

describe('stuck sends: claimed for a send, no outcome recorded', () => {
  it('counts rows claimed more than 5 minutes ago and still queued; fresh claims and finished sends do not count', async () => {
    const h = notifyHarness();
    await h.register('cust');
    expect(await h.service.stuckSends()).toEqual({ stuck: 0, oldestSec: 0 });

    // A message that went normally: sent, never stuck however old.
    await h.service.dispatch({ eventId: 'ok', template: 'order_receipt', to: 'cust', orderId: 'ord_0', params: { ...receipt, orderId: 'ord_0' } });
    await h.run();

    const rows = await claimedThenDied(h);
    expect(rows.map((r) => r.channel)).toEqual(['push', 'whatsapp']);
    h.clock.advance(NOTIFY_STUCK_AFTER_SEC * SEC);
    // Exactly 5 minutes: not yet.
    expect(await h.service.stuckSends()).toEqual({ stuck: 0, oldestSec: 0 });
    h.clock.advance(SEC);
    expect(await h.service.stuckSends()).toEqual({ stuck: 2, oldestSec: NOTIFY_STUCK_AFTER_SEC + 1 });
  });

  it('read only: the queued job running again does not send the claimed message, and the count stays', async () => {
    const push = new ScriptedPush();
    const h = notifyHarness({ push });
    await h.register('cust');
    const claimed = await claimedThenDied(h);
    h.clock.advance((NOTIFY_STUCK_AFTER_SEC + 60) * SEC);
    const before = await h.service.stuckSends();
    expect(before).toEqual({ stuck: 2, oldestSec: NOTIFY_STUCK_AFTER_SEC + 60 });
    await h.run();
    for (const r of claimed) expect((await h.repo.delivery(r.id))?.status).toBe('queued');
    expect(push.sent).toEqual([]);
    expect((await h.service.stuckSends()).stuck).toBe(2);
  });

  it('a row that recorded an outcome after its claim (failed, retried) is not stuck', async () => {
    const h = notifyHarness();
    await h.register('cust');
    const [push, wa] = await claimedThenDied(h);
    await h.repo.updateDelivery(push!.id, { status: 'failed', reason: 'push_failed', sentAt: null }, h.clock.now());
    await h.repo.updateDelivery(wa!.id, { status: 'queued', reason: 'retry:timeout', sentAt: null }, h.clock.now());
    h.clock.advance((NOTIFY_STUCK_AFTER_SEC + 1) * SEC);
    expect(await h.service.stuckSends()).toEqual({ stuck: 0, oldestSec: 0 });
  });

  it('a job machine logs an error when stuck sends appear and at most every 10 minutes while they last', async () => {
    const h = notifyHarness();
    await h.register('cust');
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const logs = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const mod = new NotifyModule(h.queue, h.engine, h.repo, {} as NotifyLookups, {} as EventsService, h.service, 'web');
    const t0 = Date.now();
    expect(await mod.checkStuckSends(t0)).toBe(false);

    const rows = await claimedThenDied(h);
    h.clock.advance((NOTIFY_STUCK_AFTER_SEC + 1) * SEC);
    const before = errors.mock.calls.length;
    expect(await mod.checkStuckSends(t0)).toBe(true);
    expect(await mod.checkStuckSends(t0 + 60_000)).toBe(true);
    expect(await mod.checkStuckSends(t0 + NOTIFY_STUCK_REPEAT_MS - 1)).toBe(true);
    expect(errors.mock.calls.slice(before).map((c) => String(c[0]))).toEqual([expect.stringMatching(/^stuck sends: 2 message\(s\) claimed/)]);
    expect(await mod.checkStuckSends(t0 + NOTIFY_STUCK_REPEAT_MS)).toBe(true);
    expect(errors.mock.calls.length - before).toBe(2);

    // Someone marks them by hand (or they age out of the queued state): the alarm clears, once.
    for (const r of rows) await h.repo.updateDelivery(r.id, { status: 'failed', reason: 'stuck_after_claim' }, h.clock.now());
    expect(await mod.checkStuckSends(t0 + NOTIFY_STUCK_REPEAT_MS + 60_000)).toBe(false);
    expect(logs.mock.calls.map((c) => String(c[0]))).toContain('stuck sends cleared: no claimed message is waiting without an outcome');
    errors.mockRestore();
    logs.mockRestore();
  });
});
