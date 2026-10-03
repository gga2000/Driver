import { z } from 'zod';
import { t, type MessageKey } from '@driver/i18n';

/**
 * What the client should do about an error (spec §12: every error carries a stable code,
 * an Iraqi-Arabic message and a retry hint).
 *  - never: fix the input or give up;
 *  - now: safe to retry immediately (transient);
 *  - later: wait (rate limit, resend cool-down) — `retryAfterSec` says how long when known;
 *  - reverify: complete an OTP re-verification first;
 *  - support: only support can resolve it.
 */
export const RetryHint = z.enum(['never', 'now', 'later', 'reverify', 'support']);
export type RetryHint = z.infer<typeof RetryHint>;

/** The wire shape of every API error's `data`. */
export const ErrorEnvelope = z.object({
  code: z.string(),
  message_ar: z.string(),
  message_en: z.string(),
  retryHint: RetryHint,
  retryAfterSec: z.number().int().nonnegative().optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

interface ErrorDef {
  /** `error.*` key in packages/i18n when one exists; the table falls back to inline text otherwise. */
  i18n?: MessageKey;
  message_ar: string;
  message_en: string;
  retryHint: RetryHint;
  /** tRPC / HTTP class the transport maps the code to. */
  status: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'TOO_MANY_REQUESTS' | 'INTERNAL_SERVER_ERROR';
}

/** Stable error-code table. Add codes here, never as ad-hoc strings in a service. */
export const ERROR_TABLE = {
  // transport / generic
  unauthorized: { i18n: 'error.session_expired', message_ar: 'سجّل دخول حتى تكمّل', message_en: 'Sign in to continue', retryHint: 'never', status: 'UNAUTHORIZED' },
  forbidden: { message_ar: 'ما عندك صلاحية لهذا الإجراء', message_en: 'You are not allowed to do this', retryHint: 'never', status: 'FORBIDDEN' },
  not_found: { message_ar: 'ما لگينا المطلوب', message_en: 'Not found', retryHint: 'never', status: 'NOT_FOUND' },
  invalid_input: { message_ar: 'المدخلات مو صحيحة. راجعها وجرب', message_en: 'Invalid input', retryHint: 'never', status: 'BAD_REQUEST' },
  internal: { i18n: 'error.server', message_ar: 'مشكلة من عدنا مو منك', message_en: 'Problem on our side', retryHint: 'later', status: 'INTERNAL_SERVER_ERROR' },
  dev_only: { message_ar: 'هذا الإجراء للتطوير فقط', message_en: 'Development only', retryHint: 'never', status: 'FORBIDDEN' },

  // identity
  phone_invalid: { i18n: 'error.phone_invalid', message_ar: 'الرقم مو صحيح', message_en: 'Invalid phone number', retryHint: 'never', status: 'BAD_REQUEST' },
  otp_invalid: { i18n: 'error.otp_invalid', message_ar: 'الرمز غلط', message_en: 'Wrong code', retryHint: 'now', status: 'BAD_REQUEST' },
  otp_expired: { i18n: 'error.otp_expired', message_ar: 'انتهى الرمز. اطلب رمز جديد', message_en: 'Code expired', retryHint: 'never', status: 'BAD_REQUEST' },
  otp_locked: { i18n: 'error.too_many_attempts', message_ar: 'محاولات كثيرة', message_en: 'Too many attempts', retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  otp_resend_too_soon: { message_ar: 'انتظر شوية قبل ما تطلب رمز جديد', message_en: 'Wait before requesting a new code', retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  rate_limited: { message_ar: 'طلبات كثيرة. انتظر شوية وجرب', message_en: 'Too many requests; try again later', retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  otp_not_found: { message_ar: 'ما أكو رمز مطلوب لهذا الرقم. اطلب رمز أول', message_en: 'No code requested for this number', retryHint: 'never', status: 'BAD_REQUEST' },
  session_expired: { i18n: 'error.session_expired', message_ar: 'انتهت جلستك', message_en: 'Session expired', retryHint: 'never', status: 'UNAUTHORIZED' },
  token_invalid: { message_ar: 'جلستك مو صالحة. سجّل دخول مرة ثانية', message_en: 'Invalid token', retryHint: 'never', status: 'UNAUTHORIZED' },
  refresh_reused: { message_ar: 'انقطعت جلستك للأمان. سجّل دخول مرة ثانية', message_en: 'Refresh token reused; session revoked', retryHint: 'never', status: 'UNAUTHORIZED' },
  reverification_required: { message_ar: 'لازم تأكد رقمك مرة ثانية بالرمز حتى تكمّل', message_en: 'Re-verify your number by OTP to continue', retryHint: 'reverify', status: 'FORBIDDEN' },
  role_frozen: { message_ar: 'هذي الصلاحية موقوفة لحد ما تأكد رقمك', message_en: 'Role frozen until re-verified', retryHint: 'reverify', status: 'FORBIDDEN' },
  shared_phone_role_forbidden: { message_ar: 'الرقم العائلي المشترك ما يگدر يكون ولي أمر أو سايق', message_en: 'A shared family phone cannot hold guardian or driver roles', retryHint: 'never', status: 'FORBIDDEN' },
  person_not_found: { message_ar: 'ما لگينا الحساب', message_en: 'Person not found', retryHint: 'never', status: 'NOT_FOUND' },
  account_suspended: { i18n: 'error.account_suspended', message_ar: 'حسابك متوقف مؤقتاً', message_en: 'Account suspended', retryHint: 'support', status: 'FORBIDDEN' },
  guardian_link_not_found: { message_ar: 'ما لگينا رابط ولي الأمر', message_en: 'Guardian link not found', retryHint: 'never', status: 'NOT_FOUND' },
  guardian_link_not_pending: { message_ar: 'هذا الرابط مو بانتظار الموافقة', message_en: 'Guardian link is not pending', retryHint: 'never', status: 'CONFLICT' },
  guardian_self_link: { message_ar: 'ما تگدر تكون ولي أمر نفسك', message_en: 'Cannot be your own guardian', retryHint: 'never', status: 'BAD_REQUEST' },
  phone_change_same_number: { message_ar: 'هذا نفس رقمك الحالي', message_en: 'Same as the current number', retryHint: 'never', status: 'BAD_REQUEST' },
  phone_change_taken: { message_ar: 'هذا الرقم مسجّل بحساب ثاني. تواصل ويا الدعم', message_en: 'That number belongs to another account', retryHint: 'support', status: 'CONFLICT' },
  phone_change_not_started: { message_ar: 'ابدي تغيير الرقم أول', message_en: 'Start the phone change first', retryHint: 'never', status: 'BAD_REQUEST' },
  lost_sim_manual: { message_ar: 'سجّلنا طلبك. الدعم يكمّله يدوياً بعد مطابقة الهوية', message_en: 'Claim recorded; support completes it manually after ID match', retryHint: 'support', status: 'CONFLICT' },
  sms_not_configured: { message_ar: 'خدمة الرسائل مو مهيأة', message_en: 'SMS gateway not configured', retryHint: 'support', status: 'INTERNAL_SERVER_ERROR' },

  // orgs / households
  org_not_found: { message_ar: 'ما لگينا الجهة', message_en: 'Org not found', retryHint: 'never', status: 'NOT_FOUND' },
  not_household_member: { message_ar: 'مو عضو بهذا البيت', message_en: 'Not a member of this household', retryHint: 'never', status: 'FORBIDDEN' },
  no_payer: { message_ar: 'ما أكو دافع بهذا البيت بعد', message_en: 'Household has no payer yet', retryHint: 'never', status: 'CONFLICT' },

  // orders
  order_not_found: { message_ar: 'ما لگينا الطلب', message_en: 'Order not found', retryHint: 'never', status: 'NOT_FOUND' },
  order_state_conflict: { message_ar: 'حالة الطلب تغيّرت. حدّث الصفحة', message_en: 'The order is not in a state that allows this', retryHint: 'never', status: 'CONFLICT' },
  order_type_not_supported: { message_ar: 'هذا النوع من الطلبات مو متاح هنا', message_en: 'Order type not supported here', retryHint: 'never', status: 'BAD_REQUEST' },
  order_empty: { message_ar: 'الطلب فارغ', message_en: 'The order has no lines', retryHint: 'never', status: 'BAD_REQUEST' },
  merchant_required: { message_ar: 'لازم تختار مطعم أو محل', message_en: 'A merchant is required for this order', retryHint: 'never', status: 'BAD_REQUEST' },
  one_merchant_per_order: { message_ar: 'كل طلب من محل واحد. الثاني يصير طلب منفصل', message_en: 'One merchant per order; start a second order', retryHint: 'never', status: 'BAD_REQUEST' },
  catalog_item_unavailable: { message_ar: 'صنف بالسلة مو متوفر هسه. حدّث السلة', message_en: 'An item is not on this menu or not available now', retryHint: 'never', status: 'CONFLICT' },
  modifier_invalid: { message_ar: 'الإضافات المختارة مو صحيحة. حدّث السلة', message_en: 'Invalid modifier selection for an item', retryHint: 'never', status: 'BAD_REQUEST' },
  price_changed: { message_ar: 'الأسعار تغيّرت. حدّث السلة وشوف المجموع الجديد', message_en: 'Menu prices changed; refresh the cart', retryHint: 'never', status: 'CONFLICT' },
  quote_location_required: { message_ar: 'حدد مكان الاستلام والتوصيل حتى نحسب السعر', message_en: 'Pickup and drop-off places are needed to price this order', retryHint: 'never', status: 'BAD_REQUEST' },
  promotion_invalid: { message_ar: 'كود الخصم مو صالح لهذا الطلب', message_en: 'No valid promotion for this discount', retryHint: 'never', status: 'BAD_REQUEST' },
  tip_above_cap: { message_ar: 'الإكرامية أكثر من الحد المسموح', message_en: 'Tip is above the per-order cap', retryHint: 'never', status: 'BAD_REQUEST' },
  merchant_paused: { message_ar: 'مغلق مؤقتاً', message_en: 'Merchant is temporarily closed', retryHint: 'later', status: 'CONFLICT' },
  participant_unknown: { message_ar: 'السطر مربوط بشخص مو موجود بالطلب', message_en: 'Line tagged to an unknown participant', retryHint: 'never', status: 'BAD_REQUEST' },
  order_cancel_after_pickup: { message_ar: 'ما ينلغي بعد الاستلام. افتح شكوى', message_en: 'Cannot cancel after pickup; open a dispute', retryHint: 'never', status: 'CONFLICT' },
  partial_accept_not_pending: { message_ar: 'ما أكو تعديل بانتظار موافقتك', message_en: 'No partial acceptance is awaiting approval', retryHint: 'never', status: 'CONFLICT' },
  partial_accept_invalid: { message_ar: 'الأسطر المختارة مو صحيحة', message_en: 'Invalid unavailable lines', retryHint: 'never', status: 'BAD_REQUEST' },
  dispute_window_closed: { message_ar: 'انتهى وقت الشكوى. تواصل ويا الدعم', message_en: 'Dispute window closed; contact support', retryHint: 'support', status: 'CONFLICT' },

  // trips
  trip_not_found: { message_ar: 'ما لگينا المشوار', message_en: 'Trip not found', retryHint: 'never', status: 'NOT_FOUND' },
  stop_not_found: { message_ar: 'ما لگينا الوقفة', message_en: 'Stop not found', retryHint: 'never', status: 'NOT_FOUND' },
  trip_state_conflict: { message_ar: 'حالة المشوار تغيّرت. حدّث الصفحة', message_en: 'The trip is not in a state that allows this', retryHint: 'never', status: 'CONFLICT' },
  stop_state_conflict: { message_ar: 'حالة الوقفة ما تسمح بهذا', message_en: 'The stop is not in a state that allows this', retryHint: 'never', status: 'CONFLICT' },
  not_trip_courier: { message_ar: 'هذا المشوار مو إلك', message_en: 'Not the courier on this trip', retryHint: 'never', status: 'FORBIDDEN' },
  vehicle_too_small: { message_ar: 'الطلب أكبر من سعة مركبتك', message_en: 'Order exceeds this vehicle class cap', retryHint: 'never', status: 'CONFLICT' },
  child_handover_required: { message_ar: 'لازم تأكد استلام/تسليم الطفل بالاسم', message_en: 'Per-child tap-in/tap-out required', retryHint: 'never', status: 'BAD_REQUEST' },
  unreachable_not_started: { message_ar: 'ابدأ "ما أگدر أوصله" أول', message_en: 'Start the unreachable protocol first', retryHint: 'never', status: 'CONFLICT' },
  unreachable_too_early: { message_ar: 'انتظر لحد ما يخلص العداد', message_en: 'Too early to fail; wait for the timer', retryHint: 'later', status: 'CONFLICT' },
  // dispatch
  dispatch_not_found: { message_ar: 'ما لگينا طلب التوزيع', message_en: 'Dispatch request not found', retryHint: 'never', status: 'NOT_FOUND' },
  offer_not_found: { message_ar: 'ما لگينا العرض', message_en: 'Offer not found', retryHint: 'never', status: 'NOT_FOUND' },
  offer_not_yours: { message_ar: 'هذا العرض مو إلك', message_en: 'This offer is not yours', retryHint: 'never', status: 'FORBIDDEN' },
  offer_expired: { message_ar: 'انتهى وقت العرض', message_en: 'Offer expired', retryHint: 'never', status: 'CONFLICT' },
  offer_taken: { message_ar: 'سايق ثاني سبقك على هذا الطلب', message_en: 'Another driver took this job', retryHint: 'never', status: 'CONFLICT' },
  offer_conflicts_current_job: { message_ar: 'هذا الطلب ما يمشي ويا شغلتك الحالية', message_en: 'This job no longer fits the job you are on', retryHint: 'never', status: 'CONFLICT' },
  over_cap: { message_ar: 'وصلت حد النقد. سدّد حتى توصلك طلبات جديدة', message_en: 'Cash cap reached; settle to get new offers', retryHint: 'support', status: 'FORBIDDEN' },
  override_invalid: { message_ar: 'ما يصير نعيّن هذا السايق هسه', message_en: 'This driver cannot be assigned now', retryHint: 'never', status: 'CONFLICT' },
  override_reason_required: { message_ar: 'اكتب سبب التعيين الإجباري', message_en: 'A forced assign needs a reason', retryHint: 'never', status: 'BAD_REQUEST' },
  // ledger (M2 Step 6)
  settlement_nothing_due: { message_ar: 'ما عندك فلوس مستحقة هسة', message_en: 'Nothing is due to this merchant now', retryHint: 'never', status: 'CONFLICT' },
  adjustment_incident_required: { message_ar: 'التصحيح يحتاج سبب وبلاغ مربوط', message_en: 'An adjustment needs a reason and a linked incident', retryHint: 'never', status: 'BAD_REQUEST' },
  adjustment_second_approver: { message_ar: 'التصحيح فوق 25,000 يحتاج موافقة شخص ثاني من المالية', message_en: 'Adjustments above the threshold need a second finance approver', retryHint: 'never', status: 'FORBIDDEN' },
  handover_mismatch: { message_ar: 'المبلغ أو الرمز ما يطابق. انفتح بلاغ للمراجعة', message_en: 'Hand-over amount or PIN mismatch; incident opened', retryHint: 'support', status: 'CONFLICT' },
  new_customer_cash_cap: { message_ar: 'أول 3 طلبات كاش حدها 25,000 دينار', message_en: 'First three cash orders are capped', retryHint: 'never', status: 'BAD_REQUEST' },
} as const satisfies Record<string, ErrorDef>;

export type ErrorCode = keyof typeof ERROR_TABLE;
export const ErrorCode = z.enum(Object.keys(ERROR_TABLE) as [ErrorCode, ...ErrorCode[]]);

/** Builds the wire envelope for a code. Arabic comes from packages/i18n when the key exists. */
export function errorEnvelope(code: ErrorCode, extra?: { retryAfterSec?: number; params?: Record<string, string | number> }): ErrorEnvelope {
  const def: ErrorDef = ERROR_TABLE[code];
  const params = { minutes: 3, ...extra?.params };
  const message_ar = def.i18n ? t(def.i18n, params, 'ar-IQ') : def.message_ar;
  const message_en = def.i18n ? t(def.i18n, params, 'en') : def.message_en;
  return {
    code,
    message_ar,
    message_en,
    retryHint: def.retryHint,
    ...(extra?.retryAfterSec !== undefined ? { retryAfterSec: extra.retryAfterSec } : {}),
  };
}

export function errorStatus(code: ErrorCode): ErrorDef['status'] {
  return ERROR_TABLE[code].status;
}

/**
 * The one error class services throw. The transport layer turns it into a TRPCError whose
 * `data` carries the envelope, so clients always get `{code, message_ar, retryHint}`.
 */
export class DriverError extends Error {
  readonly envelope: ErrorEnvelope;

  constructor(
    readonly code: ErrorCode,
    extra?: { retryAfterSec?: number; params?: Record<string, string | number>; cause?: unknown },
  ) {
    const envelope = errorEnvelope(code, extra);
    super(envelope.message_en, extra?.cause ? { cause: extra.cause } : undefined);
    this.name = 'DriverError';
    this.envelope = envelope;
  }

  get status(): ErrorDef['status'] {
    return errorStatus(this.code);
  }
}

export function isDriverError(err: unknown): err is DriverError {
  return err instanceof DriverError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'DriverError');
}
