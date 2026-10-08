import { describe, expect, it } from 'vitest';
import type { BoardOrder } from '@driver/contracts';
import { createMemoryStorage } from '@/lib/storage';
import { createReadyQueue, keepAfterSend, withQueuedReady } from './ready-queue';

const order = (id: string, column: BoardOrder['column']) => ({ id, column, state: column === 'preparing' ? 'preparing' : 'placed', readyAt: null, late: true }) as unknown as BoardOrder;

describe('offline «صار جاهز»', () => {
  it('shows a kept tap as ready on the board, only for cooking orders', () => {
    const out = withQueuedReady([order('a', 'preparing'), order('b', 'new')], [{ orderId: 'a', at: 1000 }, { orderId: 'b', at: 1000 }]);
    expect(out[0]).toMatchObject({ column: 'ready', late: false });
    expect(out[0]!.readyAt?.getTime()).toBe(1000);
    expect(out[1]!.column).toBe('new');
  });

  it('keeps a tap while there is no answer, drops it once the server answered', () => {
    expect(keepAfterSend(null)).toBe(false);
    expect(keepAfterSend(new TypeError('Network request failed'))).toBe(true);
    expect(keepAfterSend({ data: { httpStatus: 503 } })).toBe(true);
    expect(keepAfterSend({ data: { httpStatus: 409 } })).toBe(false);
  });

  it('survives a restart and sends in order, stopping at the first one with no answer', async () => {
    const mem = createMemoryStorage();
    const q1 = createReadyQueue(mem);
    q1.add('a', 1);
    q1.add('b', 2);
    q1.add('a', 3);
    const q2 = createReadyQueue(mem);
    await q2.load();
    expect(q2.snapshot().map((q) => q.orderId)).toEqual(['a', 'b']);
    const sent: string[] = [];
    const n = await q2.flush(async (id) => {
      if (id === 'b') throw new TypeError('offline');
      sent.push(id);
    });
    expect(n).toBe(1);
    expect(sent).toEqual(['a']);
    expect(q2.snapshot().map((q) => q.orderId)).toEqual(['b']);
  });
});
