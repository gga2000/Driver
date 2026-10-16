import { describe, expect, it } from 'vitest';
import { OrdersStaffJob } from './orders.staff.job.js';
import type { OrdersStaffService } from './orders.staff.js';

describe('OrdersStaffJob.tick', () => {
  it('a failing sweep() does not stop watchStuck() in the same tick (and the other way round)', async () => {
    const ran: string[] = [];
    const staff = {
      sweep: async () => {
        ran.push('sweep');
        throw new Error('sweep down');
      },
      watchStuck: async () => {
        ran.push('watchStuck');
        return 2;
      },
    } as unknown as OrdersStaffService;
    expect(await new OrdersStaffJob(staff).tick()).toBe(2);
    expect(ran).toEqual(['sweep', 'watchStuck']);

    const other = { sweep: async () => 1, watchStuck: async () => Promise.reject(new Error('board down')) } as unknown as OrdersStaffService;
    expect(await new OrdersStaffJob(other).tick()).toBe(1);
  });
});
