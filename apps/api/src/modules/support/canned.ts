import type { CannedResponse, DisputeKind, TicketKind, TicketStatus } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';

type Action = CannedResponse['action'];

/**
 * Canned Iraqi-Arabic answers for the top situations (support spec §2), each with its one-tap action.
 * Amounts are the default the agent can change before sending. The words are
 * `support.reply.<key>.title` / `.text` in packages/i18n, so they pass the voice test (audit S-08).
 */
const CANNED: ReadonlyArray<{ key: string; action: Action; amountIqd: number | null }> = [
  { key: 'late_sorry', action: 'refund', amountIqd: 1000 },
  { key: 'cold_food', action: 'fault_courier', amountIqd: 1000 },
  { key: 'missing_item', action: 'fault_merchant', amountIqd: null },
  { key: 'wrong_item', action: 'fault_merchant', amountIqd: null },
  { key: 'not_delivered', action: 'none', amountIqd: null },
  { key: 'courier_rude', action: 'fault_courier', amountIqd: null },
  { key: 'ride_fare', action: 'refund', amountIqd: null },
  { key: 'refund_done', action: 'none', amountIqd: null },
  { key: 'big_refund_cash', action: 'escalate', amountIqd: null },
  { key: 'escalate_money', action: 'escalate', amountIqd: null },
  { key: 'after_hours', action: 'none', amountIqd: null },
  { key: 'resolve_thanks', action: 'resolve', amountIqd: null },
];

export const CANNED_RESPONSES: readonly CannedResponse[] = CANNED.map((c) => ({
  key: c.key,
  title_ar: t(`support.reply.${c.key}.title` as MessageKey),
  text_ar: t(`support.reply.${c.key}.text` as MessageKey),
  action: c.action,
  amountIqd: c.amountIqd,
}));

/** The pre-selected answer per dispute kind (support spec §3 "suggested resolution pre-selected"). */
export const SUGGESTED_BY_DISPUTE: Partial<Record<DisputeKind, { cannedKey: string; reason_ar: string }>> = {
  cold_or_late: { cannedKey: 'late_sorry', reason_ar: 'شكوى تأخير أو أكل بارد: التعويض الافتراضي رصيد صغير' },
  missing_item: { cannedKey: 'missing_item', reason_ar: 'غرض ناقص: على المطعم، يرجع سعر الغرض' },
  wrong_item: { cannedKey: 'wrong_item', reason_ar: 'غرض غلط: على المطعم، يرجع سعر الغرض' },
  not_delivered: { cannedKey: 'not_delivered', reason_ar: 'ما وصل: تحقّق من صورة التسليم والموقع قبل أي تعويض' },
  ride_fare: { cannedKey: 'ride_fare', reason_ar: 'خلاف أجرة: السعر المقفول يثبت' },
};

export const DISPUTE_SUBJECT_AR: Record<DisputeKind, string> = {
  cold_or_late: 'الطلب تأخّر أو وصل بارد',
  missing_item: 'غرض ناقص بالطلب',
  wrong_item: 'غرض غلط بالطلب',
  not_delivered: 'الطلب ما وصل',
  ride_fare: 'خلاف على أجرة المشوار',
  driver_behaviour: 'شكوى على تصرف السايق',
  unsafe_driving: 'سياقة خطرة',
  other: 'مشكلة بالطلب',
};

export const KIND_AR: Record<TicketKind, string> = { dispute: 'نزاع', complaint: 'شكوى', incident: 'حادثة', question: 'استفسار' };
export const STATUS_AR: Record<TicketStatus, string> = { open: 'مفتوحة', waiting: 'بانتظار الزبون', escalated: 'مصعّدة', resolved: 'محلولة' };

/** Words that rank a ticket up as hostile in tone (support spec §3 queue by urgency). */
export const HOSTILE_WORDS: readonly string[] = ['نصاب', 'نصب', 'حرامي', 'سرقة', 'فضيحة', 'شرطة', 'محكمة', 'غش', 'احتيال', 'أفضحكم', 'تهديد'];

/** A case opened from the order's support chat («كلّم الدعم»): its subject in the queue. */
export const CHAT_SUBJECT_AR = 'محادثة من الطلب';
export function chatSubjectAr(firstMessage: string): string {
  const clipped = firstMessage.length > 60 ? `${firstMessage.slice(0, 59)}…` : firstMessage;
  return `${CHAT_SUBJECT_AR}: ${clipped}`;
}
/** The line a reopened chat case shows: the customer wrote again after it was solved. */
export function chatReopenedAr(said: string): string {
  return said ? `الزبون كتب من جديد: ${said}` : 'الزبون كتب من جديد بالمحادثة';
}
