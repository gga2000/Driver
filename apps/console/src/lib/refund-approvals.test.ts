import type { RoleKind } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { needsSecondOk, refundHref, refundRole } from './refund-approvals';

const me = (personId: string, roles: RoleKind[]) => ({ personId, roles: new Set(roles) });
const asked = (id: string) => ({ requestedBy: { id, name: 'زينب' } });

describe('refund second OK (Ali, 2026-10-08)', () => {
  it('the asker can only take it back, even an admin; finance and admin approve others', () => {
    expect(refundRole(asked('p1'), me('p1', ['admin', 'finance']))).toBe('asker');
    expect(refundRole(asked('p1'), me('p2', ['finance']))).toBe('approver');
    expect(refundRole(asked('p1'), me('p2', ['admin']))).toBe('approver');
    expect(refundRole(asked('p1'), me('p2', ['support', 'dispatcher']))).toBe('watcher');
    expect(refundRole(asked('p1'), { personId: null, roles: new Set<RoleKind>() })).toBe('watcher');
  });

  it('links to the case, else the order', () => {
    expect(refundHref({ ticketId: 'tk 1', orderId: 'o1' })).toBe('/support/tk%201');
    expect(refundHref({ ticketId: null, orderId: 'o1' })).toBe('/orders/o1');
    expect(refundHref({ ticketId: null, orderId: null })).toBeNull();
  });

  it('waits only above what the agent may give alone', () => {
    expect(needsSecondOk(10_000, 10_000)).toBe(false);
    expect(needsSecondOk(10_250, 10_000)).toBe(true);
  });
});
