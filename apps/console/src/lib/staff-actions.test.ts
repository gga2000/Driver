import { describe, expect, it } from 'vitest';
import type { RoleKind } from '@driver/contracts';
import { actionsFor, consequences } from './staff-actions';

const roles = (...r: RoleKind[]) => new Set<RoleKind>(r);

describe('stuck-order way-outs', () => {
  it('offers only what the server allows, most likely first', () => {
    const order = { actions: ['cancel', 'markDelivered', 'courierLost'] as const };
    expect(actionsFor({ actions: [...order.actions] }, roles('dispatcher'))).toEqual(['markDelivered', 'courierLost', 'cancel']);
  });

  it('hides what this person may not use', () => {
    expect(actionsFor({ actions: ['cancel', 'resolveDispute'] }, roles('finance'))).toEqual(['resolveDispute']);
    expect(actionsFor({ actions: ['cancel'] }, roles('field_ops'))).toEqual([]);
  });

  it('names the wallet refund only for orders not paid in cash, and marks what waits on Ali', () => {
    expect(consequences('cancel', { paymentMethod: 'cash' }).map((c) => c.key)).not.toContain('console.stuck.cancel_wallet');
    expect(consequences('cancel', { paymentMethod: 'wallet' }).map((c) => c.key)).toContain('console.stuck.cancel_wallet');
    expect(consequences('courierLost', { paymentMethod: 'cash' }).filter((c) => c.waits).map((c) => c.key)).toEqual(['console.stuck.lost_refund']);
  });
});
