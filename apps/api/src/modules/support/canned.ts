import type { CannedResponse, DisputeKind, TicketKind, TicketStatus } from '@driver/contracts';

/**
 * Canned Iraqi-Arabic answers for the top situations (support spec §2), each with its one-tap action.
 * Amounts are the default the agent can change before sending; Western digits per the voice guide.
 */
export const CANNED_RESPONSES: readonly CannedResponse[] = [
  { key: 'late_sorry', title_ar: 'تأخير', text_ar: 'حقّك علينا، الطلب تأخّر عليك. ضفنا لك 1,000 دينار رصيد بالمحفظة، وإن شاء الله ما تتكرر.', action: 'refund', amountIqd: 1000 },
  { key: 'cold_food', title_ar: 'الأكل بارد', text_ar: 'نعتذر منك، الأكل وصلك بارد. رجّعنالك أجرة التوصيل رصيد بالمحفظة، وراح نتابع ويا المندوب.', action: 'fault_courier', amountIqd: 1000 },
  { key: 'missing_item', title_ar: 'غرض ناقص', text_ar: 'شفنا طلبك، الغرض الناقص على المطعم. رجّعنالك سعره رصيد بالمحفظة.', action: 'fault_merchant', amountIqd: null },
  { key: 'wrong_item', title_ar: 'غرض غلط', text_ar: 'نعتذر، المطعم دزّلك غرض غير اللي طلبته. رجّعنالك سعره رصيد وبلّغنا المطعم.', action: 'fault_merchant', amountIqd: null },
  { key: 'not_delivered', title_ar: 'الطلب ما وصل', text_ar: 'دا نتابع ويا المندوب هسة. نرجعلك خلال ربع ساعة بجواب واضح.', action: 'none', amountIqd: null },
  { key: 'courier_rude', title_ar: 'تعامل المندوب', text_ar: 'نعتذر منك على هالتصرف. سجّلنا الملاحظة على المندوب وراح نتابعها وياه.', action: 'fault_courier', amountIqd: null },
  { key: 'ride_fare', title_ar: 'خلاف على الأجرة', text_ar: 'الأجرة اللي شفتها قبل الحجز هي اللي تدفعها. إذا انطلب منك أكثر، رجّعنالك الفرق رصيد بالمحفظة.', action: 'refund', amountIqd: null },
  { key: 'refund_done', title_ar: 'تم التعويض', text_ar: 'تم، ضفنا التعويض لمحفظتك. تگدر تستخدمه بطلبك الجاي.', action: 'none', amountIqd: null },
  { key: 'big_refund_cash', title_ar: 'تعويض كاش', text_ar: 'المبلغ راح يوصلك كاش ويا أول مندوب يمرّك، أو تستلمه من وكيل قريب عليك.', action: 'escalate', amountIqd: null },
  { key: 'escalate_money', title_ar: 'تصعيد', text_ar: 'حوّلنا مشكلتك للمسؤول، وراح نرجعلك اليوم إن شاء الله.', action: 'escalate', amountIqd: null },
  { key: 'after_hours', title_ar: 'خارج الدوام', text_ar: 'وصلتنا رسالتك. الدعم يرجع الساعة 10 الصبح ونحل مشكلتك أول شي.', action: 'none', amountIqd: null },
  { key: 'resolve_thanks', title_ar: 'إغلاق', text_ar: 'إن شاء الله انحلّت. إذا بعد تحتاج شي احنا موجودين من 10 الصبح لـ 12 بالليل.', action: 'resolve', amountIqd: null },
];

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
  other: 'مشكلة بالطلب',
};

export const KIND_AR: Record<TicketKind, string> = { dispute: 'نزاع', complaint: 'شكوى', incident: 'حادثة', question: 'استفسار' };
export const STATUS_AR: Record<TicketStatus, string> = { open: 'مفتوحة', waiting: 'بانتظار الزبون', escalated: 'مصعّدة', resolved: 'محلولة' };

/** Words that rank a ticket up as hostile in tone (support spec §3 queue by urgency). */
export const HOSTILE_WORDS: readonly string[] = ['نصاب', 'نصب', 'حرامي', 'سرقة', 'فضيحة', 'شرطة', 'محكمة', 'غش', 'احتيال', 'أفضحكم', 'تهديد'];
