import {
  orderTicketNumber,
  type InboxKind,
  type InboxRow,
  type InboxStaffOutcome,
} from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import type { ChipTone } from '@/components/ui';

/**
 * Console › اليوم (E1, CON-12): how each row of the Today list reads, how urgent it looks, and where
 * "افتح" takes you. The rows themselves come from the server (`inbox.list`).
 */
export const KIND_KEY: Record<InboxKind, MessageKey> = {
  sos: 'console.today.kind_sos',
  no_driver: 'console.today.kind_no_driver',
  store_silent: 'console.today.kind_store_silent',
  late: 'console.today.kind_late',
  unreachable: 'console.today.kind_unreachable',
  sweep: 'console.today.kind_sweep',
  pin_alert: 'console.today.kind_pin_alert',
  approval: 'console.today.kind_approval',
};

export const KIND_TONE: Record<InboxKind, ChipTone> = {
  sos: 'bad',
  sweep: 'bad',
  pin_alert: 'warn',
  no_driver: 'warn',
  unreachable: 'warn',
  store_silent: 'warn',
  late: 'warn',
  approval: 'neutral',
};

const REASON_KEY: Record<string, MessageKey> = {
  no_acceptance: 'console.today.reason_no_acceptance',
  passes_exhausted: 'console.today.reason_passes_exhausted',
  substitutes_exhausted: 'console.today.reason_substitutes_exhausted',
  override_declined: 'console.today.reason_override_declined',
  override_timed_out: 'console.today.reason_override_timed_out',
  departure_unknown: 'console.today.reason_departure_unknown',
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
    case 'sweep':
    case 'pin_alert':
      return '/safety';
    case 'approval':
      return '/approvals';
    case 'no_driver':
      return '/dispatch';
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
