import type { RefundApproval, RefundApprovalLimit, RoleKind } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/** Who may give the second OK (contracts REFUND_APPROVER_ROLES): finance and admin, never the asker. */
export const REFUND_APPROVERS: readonly RoleKind[] = ['finance', 'admin'];

/** Why a refund waits, in the agent's words. */
export const LIMIT_KEY: Record<RefundApprovalLimit, MessageKey> = {
  per_refund: 'console.ra_limit_per_refund',
  agent_daily: 'console.ra_limit_agent_daily',
  customer_month: 'console.ra_limit_customer_month',
  dispute: 'console.ra_limit_dispute',
};

export const STATE_TONE: Record<RefundApproval['state'], 'warn' | 'done' | 'bad' | 'neutral'> = {
  pending: 'warn',
  approved: 'done',
  declined: 'bad',
  cancelled: 'neutral',
};

export type RefundRole = 'approver' | 'asker' | 'watcher';

/**
 * What this staff member can do with a request: approve or decline it (finance / admin who did not ask
 * for it), take it back (the person who asked), or only see it. The API checks the same rules.
 */
export function refundRole(a: Pick<RefundApproval, 'requestedBy'>, me: { personId: string | null; roles: ReadonlySet<RoleKind> }): RefundRole {
  if (me.personId && a.requestedBy.id === me.personId) return 'asker';
  return REFUND_APPROVERS.some((r) => me.roles.has(r)) ? 'approver' : 'watcher';
}

/** Where the request came from: the support case, else the order's page. */
export function refundHref(a: Pick<RefundApproval, 'ticketId' | 'orderId'>): string | null {
  if (a.ticketId) return `/support/${encodeURIComponent(a.ticketId)}`;
  if (a.orderId) return `/orders/${encodeURIComponent(a.orderId)}`;
  return null;
}

/** A refund the agent asks for is over what they may give alone: it will wait for a second OK. */
export function needsSecondOk(amountIqd: number, availableIqd: number): boolean {
  return amountIqd > availableIqd;
}
