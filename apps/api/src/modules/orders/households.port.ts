import type { HouseholdApprovalReason } from '@driver/contracts';
import type { OrgsService, PayerApprovalRequest } from '../orgs/index.js';

/**
 * The household as orders needs it at placement (joy w4): who may spend its wallet, their limits,
 * and the payer's approval request for an order that waits. Bound to `OrgsService`.
 */
export interface OrdersHouseholdsPort {
  /** The person's role and limits in that household; null when it is no household or they are not in it. */
  member(householdId: string, personId: string): Promise<{ role: 'payer' | 'orderer' | 'member'; spendingLimitIqd: number | null; monthlyBudgetIqd: number | null } | null>;
  /** Asks the payer (idempotent per order); runs in the caller's unit of work when it shares one. */
  requestApproval(input: { householdId: string; orderId: string; requestedBy: string; amountIqd: number; reason: HouseholdApprovalReason }): Promise<void>;
  /** The request stops asking (the order was cancelled or nobody answered). */
  withdraw(householdId: string, orderId: string, actorId: string): Promise<void>;
  /** The payer's answer so far; null when there is no request. */
  decision(householdId: string, orderId: string): Promise<PayerApprovalRequest['state'] | null>;
}

export const ORDERS_HOUSEHOLDS = Symbol('ORDERS_HOUSEHOLDS');

/** The port over the orgs module. */
export function orgsHouseholds(orgs: OrgsService): OrdersHouseholdsPort {
  return {
    member: async (householdId, personId) => {
      const org = await orgs.find(householdId);
      if (!org || org.type !== 'household') return null;
      const m = org.members.find((x) => x.personId === personId);
      return m ? { role: m.role, spendingLimitIqd: m.spendingLimitIqd, monthlyBudgetIqd: m.monthlyBudgetIqd ?? null } : null;
    },
    requestApproval: async (i) => {
      await orgs.requestPayerApproval({ orgId: i.householdId, orderId: i.orderId, requestedBy: i.requestedBy, amountIqd: i.amountIqd, reason: i.reason });
    },
    withdraw: async (householdId, orderId, actorId) => {
      await orgs.withdrawApproval(householdId, orderId, actorId);
    },
    decision: async (householdId, orderId) => (await orgs.approvalForOrder(householdId, orderId))?.state ?? null,
  };
}
