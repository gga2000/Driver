import {
  orderTicketNumber,
  type InboxKind,
  type InboxRow,
  type InboxStaffOutcome,
} from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import type { ChipTone } from '@/components/ui';
import { formatIqd } from './format';

/**
 * Console › اليوم (E1, CON-12): how each row of the Today list reads, how urgent it looks, and where
 * "افتح" takes you. The rows themselves come from the server (`inbox.list`).
 */
export const KIND_KEY: Record<InboxKind, MessageKey> = {
  sos: 'console.today.kind_sos',
  safety_report: 'console.today.kind_safety_report',
  no_driver: 'console.today.kind_no_driver',
  store_silent: 'console.today.kind_store_silent',
  late: 'console.today.kind_late',
  unreachable: 'console.today.kind_unreachable',
  stuck: 'console.today.kind_stuck',
  cash_cap: 'console.today.kind_cash_cap',
  low_rating: 'console.today.kind_low_rating',
  sweep: 'console.today.kind_sweep',
  pin_alert: 'console.today.kind_pin_alert',
  approval: 'console.today.kind_approval',
};

export const KIND_TONE: Record<InboxKind, ChipTone> = {
  sos: 'bad',
  safety_report: 'bad',
  sweep: 'bad',
  pin_alert: 'warn',
  no_driver: 'warn',
  unreachable: 'warn',
  stuck: 'warn',
  store_silent: 'warn',
  late: 'warn',
  cash_cap: 'warn',
  low_rating: 'warn',
  approval: 'neutral',
};

/** A row's chip colour: a booked ride the system lost track of is red, not amber (nobody is looking for a driver). */
export function rowTone(row: { kind: InboxKind; facts: Record<string, unknown> }): ChipTone {
  return row.kind === 'no_driver' && row.facts['reason'] === 'request_lost' ? 'bad' : KIND_TONE[row.kind];
}

const REASON_KEY: Record<string, MessageKey> = {
  no_acceptance: 'console.today.reason_no_acceptance',
  passes_exhausted: 'console.today.reason_passes_exhausted',
  substitutes_exhausted: 'console.today.reason_substitutes_exhausted',
  override_declined: 'console.today.reason_override_declined',
  override_timed_out: 'console.today.reason_override_timed_out',
  departure_unknown: 'console.today.reason_departure_unknown',
  request_lost: 'console.today.reason_request_lost',
};

export const STUCK_KEY: Record<string, MessageKey> = {
  merchant_no_answer: 'console.today.stuck_merchant_no_answer',
  kitchen_silent: 'console.today.stuck_kitchen_silent',
  no_courier: 'console.today.stuck_no_courier',
  courier_lost: 'console.today.stuck_courier_lost',
  not_closed: 'console.today.stuck_not_closed',
  dispute_open: 'console.today.stuck_dispute_open',
  dispute_overdue: 'console.today.stuck_dispute_overdue',
  ride_no_driver: 'console.today.stuck_ride_no_driver',
  ride_driver_no_show: 'console.today.stuck_ride_driver_no_show',
  ride_not_closed: 'console.today.stuck_ride_not_closed',
};

const VERTICAL_KEY: Record<string, MessageKey> = {
  food: 'console.vertical_food',
  grocery: 'console.vertical_grocery',
  taxi: 'console.vertical_taxi',
  tuktuk: 'console.vertical_tuktuk',
  intercity: 'console.vertical_intercity',
};

const DOC_KEY: Record<string, MessageKey> = {
  national_id_front: 'partner.docs_kind_national_id_front',
  national_id_back: 'partner.docs_kind_national_id_back',
  licence: 'partner.docs_kind_licence',
  vehicle_registration: 'partner.docs_kind_vehicle_registration',
  insurance: 'partner.docs_kind_insurance',
  photo: 'partner.docs_kind_photo',
};

const CHANNEL_KEY: Record<string, MessageKey> = {
  in_app: 'console.sup_channel_in_app',
  whatsapp: 'console.sup_channel_whatsapp',
  phone: 'console.sup_channel_phone',
  system: 'console.sup_channel_system',
  chat: 'console.sup_channel_chat',
};

const RIDE_ORDER_TYPES: ReadonlySet<string> = new Set(['ride', 'seat', 'subscription']);

/** A bad-rating case closes only with a note saying what each side said (Ali, 2026-10-08). */
export const noteRequired = (row: Pick<InboxRow, 'kind'>): boolean => row.kind === 'low_rating';

/** The second line of a row: what we know about it, in a few words. */
export function detailText(
  row: Pick<InboxRow, 'kind' | 'facts' | 'orderId' | 'subjectKind'>,
): string {
  const f = row.facts;
  const parts: string[] = [];
  const order = row.orderId
    ? t('console.today.order_ref', { n: orderTicketNumber(row.orderId) })
    : null;
  switch (row.kind) {
    case 'sos':
      parts.push(
        t(
          f['role'] === 'driver'
            ? 'console.today.raised_by_driver'
            : 'console.today.raised_by_customer',
        ),
      );
      break;
    case 'no_driver': {
      const v = typeof f['vertical'] === 'string' ? VERTICAL_KEY[f['vertical']] : undefined;
      if (v) parts.push(t(v));
      const r = typeof f['reason'] === 'string' ? REASON_KEY[f['reason']] : undefined;
      if (r) parts.push(t(r));
      break;
    }
    case 'unreachable':
      parts.push(
        t(
          f['escalated'] === true
            ? 'console.today.unreachable_escalated'
            : 'console.today.unreachable_started',
        ),
      );
      break;
    case 'approval':
      parts.push(
        t(
          row.subjectKind === 'onboarding'
            ? 'console.today.approval_store'
            : 'console.today.approval_document',
        ),
      );
      if (typeof f['docKind'] === 'string' && DOC_KEY[f['docKind']])
        parts.push(t(DOC_KEY[f['docKind']]!));
      break;
    case 'stuck': {
      const r = typeof f['reason'] === 'string' ? STUCK_KEY[f['reason']] : undefined;
      if (r) parts.push(t(r));
      break;
    }
    case 'cash_cap':
      if (typeof f['cashIqd'] === 'number' && typeof f['capIqd'] === 'number')
        parts.push(
          t('console.today.cash_cap_detail', {
            cash: formatIqd(f['cashIqd']),
            cap: formatIqd(f['capIqd']),
          }),
        );
      break;
    case 'safety_report': {
      const c = typeof f['channel'] === 'string' ? CHANNEL_KEY[f['channel']] : undefined;
      if (c) parts.push(t(c));
      break;
    }
    case 'low_rating': {
      // Both scores when the food was rated too; a ride names the driver, food the courier.
      const ride = typeof f['orderType'] === 'string' && RIDE_ORDER_TYPES.has(f['orderType']);
      if (typeof f['stars'] === 'number') parts.push(t('console.today.rating_stars', { n: f['stars'] }));
      if (typeof f['food'] === 'number')
        parts.push(t('console.today.rating_food', { n: f['food'] }));
      if (typeof f['delivery'] === 'number')
        parts.push(
          t(ride ? 'console.today.rating_driver' : 'console.today.rating_courier', {
            n: f['delivery'],
          }),
        );
      break;
    }
    case 'pin_alert':
      parts.push(
        t(f['alert'] === 'cross_use' ? 'console.today.pin_cross_use' : 'console.today.pin_wrong'),
      );
      break;
    default:
      break;
  }
  if (order) parts.push(order);
  return parts.join(' · ');
}

/** Where the row's problem lives in the Console. */
export function rowHref(row: Pick<InboxRow, 'kind' | 'subjectId' | 'orderId'>): string {
  switch (row.kind) {
    case 'sos':
      return `/safety/${encodeURIComponent(row.subjectId)}`;
    case 'safety_report':
      return `/safety/report/${encodeURIComponent(row.subjectId)}`;
    case 'sweep':
    case 'pin_alert':
      return '/safety';
    case 'approval':
      return '/approvals';
    case 'no_driver':
      return '/dispatch';
    case 'cash_cap':
      return `/drivers/${encodeURIComponent(row.subjectId)}/ledger`;
    default:
      return row.orderId ? `/orders/${encodeURIComponent(row.orderId)}` : '/dispatch';
  }
}

export const OUTCOMES: readonly InboxStaffOutcome[] = [
  'fixed',
  'called',
  'handed_over',
  'no_action',
  'duplicate',
];
export const OUTCOME_KEY: Record<InboxStaffOutcome | 'auto', MessageKey> = {
  fixed: 'console.today.outcome_fixed',
  called: 'console.today.outcome_called',
  handed_over: 'console.today.outcome_handed_over',
  no_action: 'console.today.outcome_no_action',
  duplicate: 'console.today.outcome_duplicate',
  auto: 'console.today.outcome_auto',
};
