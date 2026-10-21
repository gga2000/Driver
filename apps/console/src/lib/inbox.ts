import {
  orderTicketNumber,
  type InboxKind,
  type InboxRow,
  type InboxStaffOutcome,
} from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import type { ChipTone } from '@/components/ui';
import { formatIqd } from './format';
import { countText } from './plural';

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
  late_departure: 'console.today.kind_late_departure',
  over_ceiling: 'console.today.kind_over_ceiling',
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
  late_departure: 'warn',
  over_ceiling: 'warn',
};

/**
 * A row's chip colour: a booked ride the system lost track of is red, not amber (nobody is looking for
 * a driver), and so is a الرجعة driver who never came while riders wait at the garage.
 */
export function rowTone(row: { kind: InboxKind; facts: Record<string, unknown> }): ChipTone {
  if (row.kind === 'no_driver' && row.facts['reason'] === 'request_lost') return 'bad';
  if (row.kind === 'late_departure' && row.facts['reason'] === 'driver_no_show' && Number(row.facts['riders']) > 0) return 'bad';
  return KIND_TONE[row.kind];
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
    case 'late_departure':
      parts.push(t(f['reason'] === 'not_arrived' ? 'console.garage.late_not_arrived' : 'console.garage.late_no_show'));
      if (typeof f['riders'] === 'number') parts.push(countText('console.today.late_departure_riders', f['riders']));
      break;
    case 'over_ceiling':
      if (typeof f['receiptIqd'] === 'number' && typeof f['ceilingIqd'] === 'number')
        parts.push(t('console.today.over_ceiling_detail', { receipt: formatIqd(f['receiptIqd']), ceiling: formatIqd(f['ceilingIqd']) }));
      break;
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
    case 'late_departure':
      return '/garage';
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

/**
 * While someone works the list (a row highlighted with the keys, or the mouse over it), rows that
 * arrive by themselves wait behind «N جديد · اعرضها» so the row under their hand doesn't jump.
 * Rows already on screen keep updating; an SOS never waits.
 */
export function holdRows<R extends Pick<InboxRow, 'id' | 'kind'>>(
  rows: readonly R[],
  onScreen: ReadonlySet<string> | null,
  holding: boolean,
): { shown: R[]; held: number } {
  if (!holding || onScreen === null) return { shown: [...rows], held: 0 };
  const shown = rows.filter((r) => onScreen.has(r.id) || r.kind === 'sos');
  return { shown, held: rows.length - shown.length };
}

// ───────────────────────── h7: one service at a time ─────────────────────────

/** The service chips at the top of Today: a خطوط-only person narrows the page to خطوط. */
export const SERVICES = ['delivery', 'ride', 'intercity', 'khat'] as const;
export type Service = (typeof SERVICES)[number];

export const SERVICE_KEY: Record<Service, MessageKey> = {
  delivery: 'console.today.svc_delivery',
  ride: 'console.today.svc_ride',
  intercity: 'console.today.svc_intercity',
  khat: 'console.today.svc_khat',
};

const BY_VERTICAL: Record<string, Service> = {
  food: 'delivery',
  grocery: 'delivery',
  errand: 'delivery',
  parcel: 'delivery',
  taxi: 'ride',
  tuktuk: 'ride',
  intercity: 'intercity',
  khat: 'khat',
};
const BY_ORDER_TYPE: Record<string, Service> = {
  food: 'delivery',
  grocery_catalog: 'delivery',
  errand: 'delivery',
  parcel: 'delivery',
  ride: 'ride',
  seat: 'intercity',
  subscription: 'khat',
};

/**
 * Which service a Today row belongs to, or null when it belongs to everyone (an SOS, a safety
 * report, an approval) or the row doesn't say (a trip nobody answers). Null rows show under every
 * chip, so narrowing the page never hides an emergency.
 */
export function serviceOf(row: Pick<InboxRow, 'kind' | 'facts'>): Service | null {
  const f = row.facts;
  switch (row.kind) {
    case 'store_silent':
    case 'late':
    case 'stuck':
    case 'cash_cap':
    case 'over_ceiling':
      return 'delivery';
    case 'late_departure':
      return 'intercity';
    case 'sweep':
    case 'pin_alert':
      return 'khat';
    case 'no_driver':
      return typeof f['vertical'] === 'string' ? (BY_VERTICAL[f['vertical']] ?? null) : null;
    case 'low_rating':
      return typeof f['orderType'] === 'string' ? (BY_ORDER_TYPE[f['orderType']] ?? null) : null;
    default:
      return null;
  }
}

/** Rows a service chip keeps: its own and everyone's. */
export function inService(row: Pick<InboxRow, 'kind' | 'facts'>, service: Service | null): boolean {
  if (service === null) return true;
  const own = serviceOf(row);
  return own === null || own === service;
}
