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

  // partner & merchant wave 2 (driverAccount, khat, fleet, ops, merchantAdmin)
  document_not_found: { message_ar: 'ما لگينا المستمسك', message_en: 'Document not found', retryHint: 'never', status: 'NOT_FOUND' },
  checkin_challenge_invalid: { message_ar: 'انتهى وقت التحقق. ابدأ من جديد', message_en: 'Check-in challenge unknown or expired', retryHint: 'never', status: 'BAD_REQUEST' },
  checkin_locked: { message_ar: 'فشل التحقق مرتين اليوم. فريق العمليات راح يتواصل وياك', message_en: 'Two failed check-ins today; ops will contact you', retryHint: 'support', status: 'FORBIDDEN' },
  // partner.goOnline refused by the online gate (scoring §2: daily check-in, expired documents → offline)
  online_checkin_required: { message_ar: 'سوّي التسجيل اليومي بالسيلفي قبل ما تشتغل', message_en: 'Do the daily selfie check-in before going online', retryHint: 'never', status: 'FORBIDDEN' },
  online_document_expired: { message_ar: 'عندك مستمسك منتهي. جدّده حتى تشتغل', message_en: 'A document has expired; renew it to go online', retryHint: 'never', status: 'FORBIDDEN' },
  // partner.goOnline: the vehicle is the registered one, and it has to fit his roles (backend review 2026-10-04 #20)
  vehicle_not_registered: { message_ar: 'هذي المركبة مو مسجّلة باسمك أو ما تناسب شغلك. سجّل مركبتك ويا العمليات أو صاحب الأسطول', message_en: 'Go online with your registered vehicle, one that fits your roles', retryHint: 'support', status: 'FORBIDDEN' },
  khat_not_child_stop: { message_ar: 'هذي المحطة ما بيها طفل لهذا الإجراء', message_en: 'This stop has no child for this tap', retryHint: 'never', status: 'BAD_REQUEST' },
  khat_child_not_on_trip: { message_ar: 'هذا الطفل مو على هذا الخط اليوم', message_en: 'The child is not on this run', retryHint: 'never', status: 'NOT_FOUND' },
  khat_child_not_tapped_in: { message_ar: 'هذا الطفل ما انسجل صعوده بالبيت. سجّل صعوده أول', message_en: 'The child was never tapped in on this run', retryHint: 'never', status: 'CONFLICT' },
  khat_child_absent: { message_ar: 'هذا الطفل مسجّل غايب اليوم', message_en: 'The child was reported absent for this run', retryHint: 'never', status: 'CONFLICT' },
  fleet_not_found: { message_ar: 'ما لگينا الأسطول', message_en: 'Fleet not found', retryHint: 'never', status: 'NOT_FOUND' },
  fleet_ambiguous: { message_ar: 'عندك أكثر من أسطول. اختار واحد', message_en: 'Several fleets: pass fleetOrgId', retryHint: 'never', status: 'BAD_REQUEST' },
  vehicle_not_found: { message_ar: 'ما لگينا المركبة', message_en: 'Vehicle not found', retryHint: 'never', status: 'NOT_FOUND' },
  vehicle_plate_taken: { message_ar: 'هذي اللوحة مسجّلة على مركبة ثانية', message_en: 'Plate already registered', retryHint: 'never', status: 'CONFLICT' },
  driver_not_in_fleet: { message_ar: 'هذا السايق مو ضمن أسطولك', message_en: 'Driver is not in this fleet', retryHint: 'never', status: 'FORBIDDEN' },
  handover_code_invalid: { message_ar: 'رمز التسليم غلط. خلي المندوب يقرا الرمز من تطبيقه', message_en: 'Hand-over code does not match', retryHint: 'now', status: 'BAD_REQUEST' },
  handover_code_locked: { message_ar: 'انقفل رمز التسليم لهذا المندوب اليوم بعد محاولات غلط كثيرة. كلّم العمليات', message_en: 'Too many wrong hand-over codes for this courier today', retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  cash_receipt_exceeds_held: { message_ar: 'المبلغ أكثر من الكاش اللي بذمة المندوب', message_en: 'Amount is more than the cash the courier holds', retryHint: 'never', status: 'CONFLICT' },
  task_not_found: { message_ar: 'ما لگينا المهمة', message_en: 'Task not found', retryHint: 'never', status: 'NOT_FOUND' },
  menu_item_not_found: { message_ar: 'ما لگينا الأكلة بالمنيو', message_en: 'Menu item not found', retryHint: 'never', status: 'NOT_FOUND' },
  import_job_not_found: { message_ar: 'ما لگينا رفع المنيو', message_en: 'Menu import not found', retryHint: 'never', status: 'NOT_FOUND' },
  import_state_conflict: { message_ar: 'هذا الرفع انطبق قبل', message_en: 'Menu import already applied or discarded', retryHint: 'never', status: 'CONFLICT' },
  deal_not_found: { message_ar: 'ما لگينا العرض', message_en: 'Deal not found', retryHint: 'never', status: 'NOT_FOUND' },
  deal_invalid: { message_ar: 'العرض مو صحيح. راجع النسبة والمدة', message_en: 'Invalid deal (value, items or schedule)', retryHint: 'never', status: 'BAD_REQUEST' },
  deal_state_conflict: { message_ar: 'حالة العرض ما تسمح بهذا', message_en: 'The deal is not in a state that allows this', retryHint: 'never', status: 'CONFLICT' },
  dispute_response_closed: { message_ar: 'انتهت مهلة الرد على الشكوى (48 ساعة) والنتيجة الافتراضية ثبتت', message_en: 'The 48-hour window to answer this dispute has closed', retryHint: 'never', status: 'CONFLICT' },
  dispute_not_found: { message_ar: 'ما لگينا الشكوى', message_en: 'Dispute not found', retryHint: 'never', status: 'NOT_FOUND' },
  staff_last_owner: { message_ar: 'لازم يبقى صاحب واحد على الأقل', message_en: 'A merchant needs at least one owner', retryHint: 'never', status: 'CONFLICT' },

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
  household_payer_only: { message_ar: 'بس الدافع بالبيت يگدر يسوي هذا', message_en: 'Only a household payer can do this', retryHint: 'never', status: 'FORBIDDEN' },
  household_exists: { message_ar: 'إنت أصلاً عضو ببيت', message_en: 'You already belong to a household', retryHint: 'never', status: 'CONFLICT' },

  // places / uploads (domain §7)
  location_weak: { i18n: 'error.location_weak', message_ar: 'إشارة الـ GPS ضعيفة', message_en: 'GPS fix too weak', retryHint: 'now', status: 'BAD_REQUEST' },
  place_not_found: { message_ar: 'ما لگينا المكان', message_en: 'Place not found', retryHint: 'never', status: 'NOT_FOUND' },
  outside_zone: { i18n: 'error.outside_zone', message_ar: 'هذا الموقع برا منطقة الخدمة حالياً', message_en: 'This location is outside the service area', retryHint: 'never', status: 'BAD_REQUEST' },
  upload_invalid: { i18n: 'error.upload_failed', message_ar: 'ما انرفعت الصورة. جرب مرة ثانية', message_en: 'Upload missing, expired or invalid', retryHint: 'now', status: 'BAD_REQUEST' },

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
  // merchant deals at checkout: the deal the cart was shown ended, ran out of budget or changed
  deal_changed: { message_ar: 'العرض انتهى أو خلصت ميزانيته. حدّثنا المجموع، شوفه وأكّد', message_en: 'The deal ended or changed; review the new total', retryHint: 'never', status: 'CONFLICT' },
  // wallet top-up (cash to an ops agent or the next courier)
  topup_amount_invalid: { message_ar: 'المبلغ لازم يكون من 5,000 لحد 100,000 دينار وبالألف', message_en: 'Top-up must be 5,000–100,000 IQD in steps of 1,000', retryHint: 'never', status: 'BAD_REQUEST' },
  topup_daily_limit: { message_ar: 'وصلت حد الشحن لليوم. جرب باچر', message_en: 'Daily top-up limit reached', retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  topup_code_invalid: { message_ar: 'الرمز غلط. تأكد من الأرقام الستة', message_en: 'Top-up code not found', retryHint: 'never', status: 'NOT_FOUND' },
  topup_expired: { message_ar: 'انتهى الرمز. خلي الزبون يطلع رمز جديد', message_en: 'Top-up code expired', retryHint: 'never', status: 'CONFLICT' },
  topup_code_used: { message_ar: 'هذا الرمز انستخدم قبل', message_en: 'Top-up code already used', retryHint: 'never', status: 'CONFLICT' },
  topup_amount_mismatch: { message_ar: 'المبلغ مو نفس المبلغ المطلوب بالرمز', message_en: 'Cash received does not match the requested amount', retryHint: 'never', status: 'BAD_REQUEST' },
  topup_courier_not_assigned: { message_ar: 'تگدر تشحن بس لزبون عندك طلبه هسة', message_en: 'Couriers can only top up a customer whose order they carry', retryHint: 'never', status: 'FORBIDDEN' },
  tip_above_cap: { message_ar: 'الإكرامية أكثر من الحد المسموح', message_en: 'Tip is above the per-order cap', retryHint: 'never', status: 'BAD_REQUEST' },
  merchant_paused: { message_ar: 'مغلق مؤقتاً', message_en: 'Merchant is temporarily closed', retryHint: 'later', status: 'CONFLICT' },
  // backend review 2026-10-04 (apps review #10, #11): opening hours and the restaurant minimum, server-side
  merchant_closed: { message_ar: 'المطعم مسكّر هسه. اطلب من يفتح أو احجز طلبك لوقت الفتح', message_en: 'The restaurant is closed now; order when it opens or schedule for opening time', retryHint: 'later', status: 'CONFLICT' },
  order_below_minimum: { message_ar: 'طلبك أقل من أقل طلب للمطعم. ضيف شي للسلة وكمّل', message_en: 'The order is below the restaurant minimum', retryHint: 'never', status: 'BAD_REQUEST' },
  participant_unknown: { message_ar: 'السطر مربوط بشخص مو موجود بالطلب', message_en: 'Line tagged to an unknown participant', retryHint: 'never', status: 'BAD_REQUEST' },
  order_cancel_after_pickup: { message_ar: 'ما ينلغي بعد الاستلام. افتح شكوى', message_en: 'Cannot cancel after pickup; open a dispute', retryHint: 'never', status: 'CONFLICT' },
  partial_accept_not_pending: { message_ar: 'ما أكو تعديل بانتظار موافقتك', message_en: 'No partial acceptance is awaiting approval', retryHint: 'never', status: 'CONFLICT' },
  partial_accept_invalid: { message_ar: 'الأسطر المختارة مو صحيحة', message_en: 'Invalid unavailable lines', retryHint: 'never', status: 'BAD_REQUEST' },
  dispute_window_closed: { message_ar: 'انتهى وقت الشكوى. تواصل ويا الدعم', message_en: 'Dispute window closed; contact support', retryHint: 'support', status: 'CONFLICT' },

  // chat, masked calls, share-trip (notifications & support §2, scoring & safety §5)
  chat_not_party: { message_ar: 'إنت مو طرف بهذي المحادثة', message_en: 'Not a party of this chat', retryHint: 'never', status: 'FORBIDDEN' },
  chat_not_open: { message_ar: 'المحادثة تنفتح من ينقبل الطلب', message_en: 'The chat opens when the order is accepted', retryHint: 'later', status: 'CONFLICT' },
  chat_closed: { message_ar: 'انسدّت المحادثة. تگدر تقراها بس', message_en: 'The chat is closed (read-only)', retryHint: 'never', status: 'CONFLICT' },
  chat_quick_reply_invalid: { message_ar: 'هذا الرد السريع مو إلك بهذي المحادثة', message_en: 'Quick reply not available for this role or thread', retryHint: 'never', status: 'BAD_REQUEST' },
  call_unavailable: { message_ar: 'اتصل من خلال التطبيق غير متوفر', message_en: 'In-app calling is not available', retryHint: 'later', status: 'CONFLICT' },
  share_link_invalid: { message_ar: 'رابط المشاركة مو صحيح', message_en: 'Share link not found or invalid', retryHint: 'never', status: 'NOT_FOUND' },
  share_not_shareable: { message_ar: 'بس المشاوير والرجعة تنشارك', message_en: 'Only rides and intercity seats can be shared', retryHint: 'never', status: 'BAD_REQUEST' },
  share_trip_over: { message_ar: 'المشوار خلص، ما يحتاج تشاركه', message_en: 'The trip is over; nothing to share', retryHint: 'never', status: 'CONFLICT' },

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
  payout_exceeds_balance: { message_ar: 'المبلغ أكثر من المستحق للمحل هسه. ادفع المستحق أو أقل منه', message_en: 'Payout is more than the merchant is owed', retryHint: 'never', status: 'CONFLICT' },
  settlement_nothing_due: { message_ar: 'ما عندك فلوس مستحقة هسة', message_en: 'Nothing is due to this merchant now', retryHint: 'never', status: 'CONFLICT' },
  adjustment_incident_required: { message_ar: 'التصحيح يحتاج سبب وبلاغ مربوط', message_en: 'An adjustment needs a reason and a linked incident', retryHint: 'never', status: 'BAD_REQUEST' },
  adjustment_second_approver: { message_ar: 'التصحيح فوق 25,000 يحتاج موافقة شخص ثاني من المالية', message_en: 'Adjustments above the threshold need a second finance approver', retryHint: 'never', status: 'FORBIDDEN' },
  handover_mismatch: { message_ar: 'المبلغ أو الرمز ما يطابق. انفتح بلاغ للمراجعة', message_en: 'Hand-over amount or PIN mismatch; incident opened', retryHint: 'support', status: 'CONFLICT' },
  new_customer_cash_cap: { message_ar: 'أول 3 طلبات كاش حدها 25,000 دينار', message_en: 'First three cash orders are capped', retryHint: 'never', status: 'BAD_REQUEST' },
  // routes — الرجعة (intercity)
  garage_not_found: { message_ar: 'ما لگينا الكراج', message_en: 'Garage not found', retryHint: 'never', status: 'NOT_FOUND' },
  corridor_not_found: { message_ar: 'هذا الخط مو متوفر', message_en: 'Corridor not found', retryHint: 'never', status: 'NOT_FOUND' },
  announce_invalid: { message_ar: 'وقت الطلعة أو آخر وقت مو صحيح. راجعهم', message_en: 'Departure time or latest departure is not valid', retryHint: 'never', status: 'BAD_REQUEST' },
  departure_not_found: { message_ar: 'ما لگينا الرحلة', message_en: 'Departure not found', retryHint: 'never', status: 'NOT_FOUND' },
  departure_state_conflict: { message_ar: 'حالة الرحلة تغيّرت. حدّث الصفحة', message_en: 'The departure is not in a state that allows this', retryHint: 'never', status: 'CONFLICT' },
  not_departure_driver: { message_ar: 'هذي الرحلة مو إلك', message_en: 'Not the driver of this departure', retryHint: 'never', status: 'FORBIDDEN' },
  seat_unavailable: { i18n: 'intercity.seat_taken_toast', message_ar: 'أحد حجز المقعد قبلك. اختار مقعد ثاني', message_en: 'That seat is no longer free', retryHint: 'never', status: 'CONFLICT' },
  seat_adjacency_blocked: { message_ar: 'هذا المقعد بين راكبين غرباء. اختار مقعد ثاني أو احجز الصف', message_en: 'Seat blocked by the travelling-as rule; pick another seat or book the row', retryHint: 'never', status: 'CONFLICT' },
  family_only_departure: { message_ar: 'هذي الرحلة للعوائل بس', message_en: 'This departure is family-only', retryHint: 'never', status: 'CONFLICT' },
  booking_not_found: { message_ar: 'ما لگينا الحجز', message_en: 'Booking not found', retryHint: 'never', status: 'NOT_FOUND' },
  booking_state_conflict: { message_ar: 'حالة الحجز تغيّرت. حدّث الصفحة', message_en: 'The booking is not in a state that allows this', retryHint: 'never', status: 'CONFLICT' },
  hold_expired: { i18n: 'intercity.hold_expired', message_ar: 'انتهى وقت الحجز، اختار المقعد مرة ثانية', message_en: 'The 10-minute hold expired', retryHint: 'never', status: 'CONFLICT' },
  wallet_insufficient: { message_ar: 'رصيد المحفظة ما يكفي. اشحن أو احجز كاش', message_en: 'Wallet balance is not enough', retryHint: 'never', status: 'CONFLICT' },
  cash_reservation_revoked: { message_ar: 'بعد غيابين، الحجز لازم يكون مدفوع مقدماً', message_en: 'Cash reservations revoked after two no-shows; prepay to book', retryHint: 'never', status: 'FORBIDDEN' },
  seat_cancel_too_late: { message_ar: 'الصعود بدأ. ما ينلغي الحجز المدفوع هسة', message_en: 'Boarding has opened; a prepaid seat can no longer be cancelled', retryHint: 'never', status: 'CONFLICT' },
  pin_invalid: { message_ar: 'الرمز ما يطابق أي حجز بهذي الرحلة', message_en: 'PIN does not match a booking on this departure', retryHint: 'now', status: 'BAD_REQUEST' },
  walkup_seat_taken: { message_ar: 'هذا المقعد محجوز. المحجوز ما ينطى لراكب من الكراج', message_en: 'A booked or held seat cannot be given to a walk-up', retryHint: 'never', status: 'CONFLICT' },
  no_show_not_allowed: { message_ar: 'ما يصير تسجّله غايب هسة. الراكب بالكراج أو بعده وقت', message_en: 'No-show not allowed yet (rider present, or grace/meter not over)', retryHint: 'later', status: 'CONFLICT' },
  depart_blocked: { message_ar: 'كل راكب محجوز لازم يسجّل حضور أو ينحسب غايب قبل الحركة', message_en: 'Every booked seat must be checked in or a no-show before departing', retryHint: 'never', status: 'CONFLICT' },
  pickup_invalid: { message_ar: 'نقطة الصعود مو على هذا الخط', message_en: 'Pickup point is not on this corridor', retryHint: 'never', status: 'BAD_REQUEST' },
  door_pickup_limit: { message_ar: 'السيارة وصلت حد الاستلام من البيوت. اختار الكراج أو نقطة على الطريق', message_en: 'Door pickups full for this departure (max 2, 15 min detour)', retryHint: 'never', status: 'CONFLICT' },
  demand_not_found: { message_ar: 'ما لگينا الطلب', message_en: 'Demand post not found', retryHint: 'never', status: 'NOT_FOUND' },
  demand_state_conflict: { message_ar: 'هذا الطلب ما ينعدل هسة', message_en: 'Demand post is not open', retryHint: 'never', status: 'CONFLICT' },
  request_not_found: { message_ar: 'ما لگينا الطلب', message_en: 'Request not found', retryHint: 'never', status: 'NOT_FOUND' },
  request_state_conflict: { message_ar: 'حالة الطلب تغيّرت. حدّث الصفحة', message_en: 'The request is not in a state that allows this', retryHint: 'never', status: 'CONFLICT' },
  offer_price_invalid: { message_ar: 'السعر لازم يكون بالآلاف (1,000، 2,000…)', message_en: 'Offers must be multiples of 1,000', retryHint: 'never', status: 'BAD_REQUEST' },
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
