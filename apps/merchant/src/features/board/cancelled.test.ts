import { describe, expect, it } from 'vitest';
import type { CancelledOrder } from '@driver/contracts';
import { visibleCancelled } from './cancelled';

const card = (id: string, wasReady = false): CancelledOrder => ({ orderId: id, number: id.slice(-4), wasReady, cancelledAt: new Date('2026-10-04T18:00:00Z'), itemCount: 2, totalIqd: 12_500 });

describe('an accepted order that is cancelled shows as a red card until tapped away', () => {
  it('shows every cancelled card the device has not dismissed, in the server order', () => {
    const list = [card('ord_2001'), card('ord_1002', true)];
    expect(visibleCancelled(list, new Set())).toEqual(list);
    expect(visibleCancelled(list, new Set(['ord_2001']))).toEqual([list[1]]);
  });
  it('an older API without the list shows nothing', () => {
    expect(visibleCancelled(undefined, new Set())).toEqual([]);
  });
});
