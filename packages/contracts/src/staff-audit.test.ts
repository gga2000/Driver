import { describe, expect, it } from 'vitest';
import type { RoleKind } from './auth.js';
import { appRouter } from './router.js';

/**
 * CON-10, step one (Console build plan E0): every staff write must say where its audit trail is.
 * A staff mutation is any mutation a Console role may call. Each one is either AUDITED (writes a
 * console_audit_log row in the same unit of work today) or a known GAP that E3 closes. A new staff
 * mutation in neither list fails this test, so nobody ships a Console action with no trail by
 * accident; moving a GAP to AUDITED is the E3 work.
 */
const STAFF: ReadonlySet<RoleKind> = new Set(['admin', 'dispatcher', 'support', 'finance', 'field_ops']);

const AUDITED = [
  'finance.exportSettlement',
  'ops.controls.setSwitch',
  'ops.controls.setScreen',
  'ops.controls.setCapacity',
  'system.setBanner',
  'system.clearBanner',
  'system.setQuietDays',
  'system.setSeason',
  'system.setIftarTime',
  'ops.pickupSpots.set',
  'ops.dishPhotos.keep',
  'ops.dishPhotos.takeDown',
  'safety.acknowledge',
  'safety.resolve',
  'safety.requestCall',
  'support.open',
  'support.reply',
  'support.refund',
  'support.refundApprovals.approve',
  'support.refundApprovals.cancel',
  'support.refundApprovals.decline',
  'support.attributeFault',
  'support.escalate',
  'support.resolve',
  'ops.zones.clearCheckFlag',
  'ops.zones.place',
  'ops.zones.create',
  'ops.zones.rename',
  'ops.zones.remove',
  'approvals.decide',
  'driverAccount.pause',
  'driverAccount.liftPause',
  'khat.closeSweepAlert',
  'system.clearQuietDays',
  'system.clearSeason',
  'phoneBookings.book',
  'phoneBookings.cancel',
  'inbox.take',
  'inbox.assign',
  'inbox.snooze',
  'inbox.done',
  'inbox.note',
  'onCall.add',
  'onCall.end',
  // W3 staff way-outs (lane A): each writes its console_audit_log row in the same transaction.
  'orders.ops.cancel',
  'orders.ops.markDelivered',
  'orders.ops.close',
  'orders.ops.courierLost',
  'orders.ops.chargeCourier',
  'orders.ops.resolveDispute',
  'routes.ops.cancelDeparture',
  'routes.ops.arriveDeparture',
  'routes.ops.closeDeparture',
];

/** Staff writes with no console audit row yet (CON-10; logging lands in E3). Reason per line. */
const GAPS: Record<string, string> = {
  'dispatch.nudgeZone': 'no trail',
  'dispatch.override': 'domain event only (dispatch override, CON-10)',
  'dispatch.setPolicy': 'policy change, no trail (CON-10)',
  'routes.ops.hideReview': 'domain event only (review.hidden); trips thread owns routes',
  'routes.ops.unhideReview': 'domain event only (review.unhidden); trips thread owns routes',
  'driverAccount.reviewDocument': 'review stored on the document',
  'identity.grantRole': 'role grant, no console row (CON-10)',
  'identity.revokeRole': 'role revoke, no console row (CON-10)',
  'khat.callSweepDriver': 'no trail',
  'ledger.runNightly': 'ledger entries only',
  'merchantAdmin.deals.review': 'stored on the deal',
  'ops.addLandmarkPhoto': 'no trail',
  'onCall.present': 'heartbeat (a screen is open), not an action',
  'ops.completeTask': 'stored on the task',
  'ops.confirmTopUp': 'ledger entries only (cash, CON-10)',
  'ops.menuPhotos.addShot': 'stored on the shot',
  'ops.menuPhotos.markShot': 'stored on the shot',
  'ops.menuPhotos.schedule': 'stored on the schedule',
  'ops.merchantOnboarding': 'no trail',
  'ops.recordCashReceipt': 'ledger entries only (cash receipt, CON-10)',
  'routes.ops.callPinAlertDriver': 'no trail',
  'safety.note': 'stored on the incident',
  'support.chatRead': 'read marker, not an action (may stay a gap)',
  'system.simulator.start': 'dev tool, off in production',
  'system.simulator.stop': 'dev tool, off in production',
  'trips.cancel': 'trip event only (dispatcher path)',
  'trips.fail': 'trip event only (dispatcher path)',
};

function staffMutations(): string[] {
  const procedures = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string; meta?: { roles?: readonly RoleKind[] } } }> } })._def.procedures;
  return Object.entries(procedures)
    .filter(([, p]) => p._def.type === 'mutation' && (p._def.meta?.roles ?? []).some((r) => STAFF.has(r)))
    .map(([path]) => path)
    .sort();
}

describe('every staff write declares its audit trail (CON-10)', () => {
  it('finds the staff mutations from the router itself', () => {
    expect(staffMutations().length).toBeGreaterThan(40);
  });

  it('each staff mutation is AUDITED or a named GAP, never neither or both', () => {
    const found = staffMutations();
    const unclassified = found.filter((p) => !AUDITED.includes(p) && !(p in GAPS));
    expect(unclassified, 'new staff mutation: write an audit row (AUDITED) or name it in GAPS').toEqual([]);
    expect(AUDITED.filter((p) => p in GAPS), 'listed twice').toEqual([]);
    const stale = [...AUDITED, ...Object.keys(GAPS)].filter((p) => !found.includes(p));
    expect(stale, 'listed but no longer a staff mutation').toEqual([]);
  });
});
