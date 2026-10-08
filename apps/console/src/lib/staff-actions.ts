import type { RoleKind, StaffOpsSwitches, StuckOrder } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/**
 * Console › stuck orders (W3, lane A's `orders.ops.*`): what each staff way-out is called, what it
 * does, who may use it and the ready reasons offered with it. The server decides which actions fit an
 * order (`StuckOrder.actions`); money outcomes Ali has not decided are refused there with
 * `money_rule_off`, and the dialogs say so before anyone clicks.
 */
export type StaffAction = StuckOrder['actions'][number];

/** The order the actions are offered in: the one that usually ends it first. */
export const ACTION_ORDER: readonly StaffAction[] = ['markDelivered', 'close', 'resolveDispute', 'courierLost', 'cancel'];

export const ACTION_KEY: Record<StaffAction, MessageKey> = {
  cancel: 'console.stuck.act_cancel',
  markDelivered: 'console.stuck.act_markDelivered',
  close: 'console.stuck.act_close',
  courierLost: 'console.stuck.act_courierLost',
  resolveDispute: 'console.stuck.act_resolveDispute',
};

export const DONE_KEY: Record<StaffAction, MessageKey> = {
  cancel: 'console.stuck.done_cancel',
  markDelivered: 'console.stuck.done_markDelivered',
  close: 'console.stuck.done_close',
  courierLost: 'console.stuck.done_courierLost',
  resolveDispute: 'console.stuck.done_resolveDispute',
};

/** Who may use each one (the router's role lists: `ORDER_OPS_ROLES`, `SUPPORT_DESK_ROLES`). */
export const ACTION_ROLES: Record<StaffAction, readonly RoleKind[]> = {
  cancel: ['dispatcher', 'support', 'admin'],
  markDelivered: ['dispatcher', 'support', 'admin'],
  close: ['dispatcher', 'support', 'admin'],
  courierLost: ['dispatcher', 'support', 'admin'],
  resolveDispute: ['support', 'dispatcher', 'finance', 'admin'],
};

/** Ready reasons: one tap fills the reason box (staff can still edit it). */
export const QUICK_REASONS: Record<StaffAction, readonly MessageKey[]> = {
  cancel: ['console.stuck.q_customer_asked', 'console.stuck.q_store_closed', 'console.stuck.q_lost_wait', 'console.stuck.q_duplicate'],
  markDelivered: ['console.stuck.q_customer_got_it', 'console.stuck.q_app_missed'],
  close: ['console.stuck.q_no_complaint', 'console.stuck.q_store_confirmed'],
  courierLost: ['console.stuck.q_no_answer', 'console.stuck.q_courier_said'],
  resolveDispute: ['console.stuck.q_saw_photos', 'console.stuck.q_called_both'],
};

/** One line of "what happens"; `waits` lines are the parts that wait on Ali (shown as a note, not a promise). */
export interface Consequence {
  key: MessageKey;
  waits?: boolean;
}

/** Lane A's `orders.ops.switches`: which money rules are on. Null while it loads (every money line then reads "waits on Ali"). */
export type OpsSwitches = StaffOpsSwitches;

export function consequences(action: StaffAction, o: { paymentMethod: string }, sw: OpsSwitches | null = null): Consequence[] {
  switch (action) {
    case 'cancel':
      return [
        { key: 'console.stuck.cancel_free' },
        ...(o.paymentMethod !== 'cash' ? [{ key: 'console.stuck.cancel_wallet' as const }] : []),
        { key: 'console.stuck.cancel_courier' },
        sw?.freeCancel ? { key: 'console.stuck.cancel_kitchen_rule' } : { key: 'console.stuck.cancel_kitchen', waits: true },
      ];
    case 'markDelivered':
      return [{ key: 'console.stuck.md_path' }];
    case 'close':
      return [{ key: 'console.stuck.close_now' }, { key: 'console.stuck.close_no_dispute' }];
    case 'courierLost':
      return [
        { key: 'console.stuck.lost_dispute' },
        sw?.courierLostRefund ? { key: 'console.stuck.lost_refund_on' } : { key: 'console.stuck.lost_refund', waits: true },
        ...(sw?.courierLostCharge ? [{ key: 'console.stuck.lost_charge' as const }] : []),
      ];
    case 'resolveDispute':
      return [];
  }
}

export const DISPUTE_OUTCOMES = ['stands', 'refund_full', 'refund_partial', 'redelivery', 'void'] as const;
export type DisputeOutcomeChoice = (typeof DISPUTE_OUTCOMES)[number];

export const OUTCOME_KEY: Record<DisputeOutcomeChoice, MessageKey> = {
  stands: 'console.stuck.out_stands',
  refund_full: 'console.stuck.out_refund_full',
  refund_partial: 'console.stuck.out_refund_partial',
  redelivery: 'console.stuck.out_redelivery',
  void: 'console.stuck.out_void',
};

export const OUTCOME_HINT_KEY: Record<DisputeOutcomeChoice, MessageKey> = {
  stands: 'console.stuck.out_hint_stands',
  refund_full: 'console.stuck.out_hint_refund',
  refund_partial: 'console.stuck.out_hint_refund',
  redelivery: 'console.stuck.out_hint_redelivery',
  void: 'console.stuck.out_hint_void',
};

/** The outcomes offered: all of them until the switches read is wired, then only those the server lists ("void" always is). */
export function outcomesFor(sw: OpsSwitches | null): DisputeOutcomeChoice[] {
  return DISPUTE_OUTCOMES.filter((o) => !sw || o === 'void' || sw.disputeOutcomes.includes(o));
}

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** The actions this person may use on this order, most likely first. */
export function actionsFor(order: Pick<StuckOrder, 'actions'>, roles: ReadonlySet<RoleKind>): StaffAction[] {
  return ACTION_ORDER.filter((a) => order.actions.includes(a) && ACTION_ROLES[a].some((r) => roles.has(r)));
}
