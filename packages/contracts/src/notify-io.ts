import { z } from 'zod';
import type { MessageKey } from '@driver/i18n';
import type { Actor } from './identity-io.js';

/**
 * Notifications (domain §8, notifications & support spec §1): push first; WhatsApp for money and
 * safety; SMS for OTP and as the twin of a critical message that did not arrive. The API's `notify`
 * module owns delivery (providers, routing, preferences, the delivery log); this file is the
 * client-facing contract and the template catalogue every side reads (the API renders it, the apps
 * show the settings it implies, `docs/whatsapp-templates.md` lists the WhatsApp texts to submit).
 */

export const NotifyChannel = z.enum(['push', 'sms', 'whatsapp']);
export type NotifyChannel = z.infer<typeof NotifyChannel>;

/** Which of the three apps a push token belongs to (a template targets one app's tokens). */
export const NotifyApp = z.enum(['customer', 'partner', 'merchant']);
export type NotifyApp = z.infer<typeof NotifyApp>;

export const PushPlatform = z.enum(['ios', 'android', 'web']);
export type PushPlatform = z.infer<typeof PushPlatform>;

/** `expo`: an `ExponentPushToken[…]` (Expo push service); `fcm`: a raw FCM registration token. */
export const PushTokenKind = z.enum(['expo', 'fcm']);
export type PushTokenKind = z.infer<typeof PushTokenKind>;

// ───────────────────────── Android channels ─────────────────────────

/**
 * Android notification channels the apps create at start. `offers` rings loud with the custom
 * `offer.wav` (partner job offers, merchant new orders); `marketing` is silent and its server-side
 * preference is off by default.
 */
export const AndroidChannelId = z.enum(['offers', 'orders', 'chat', 'marketing']);
export type AndroidChannelId = z.infer<typeof AndroidChannelId>;

export interface AndroidChannelDef {
  id: AndroidChannelId;
  nameKey: MessageKey;
  descriptionKey?: MessageKey;
  /** expo-notifications `AndroidImportance` name. */
  importance: 'MAX' | 'HIGH' | 'DEFAULT' | 'LOW';
  /** Bundled sound file name (`offer.wav`), `default`, or null for silent. */
  sound: string | null;
  vibrationPattern: readonly number[] | null;
  /** Which apps create the channel. */
  apps: readonly NotifyApp[];
}

export const OFFER_SOUND = 'offer.wav';

export const ANDROID_CHANNELS: Readonly<Record<AndroidChannelId, AndroidChannelDef>> = {
  offers: { id: 'offers', nameKey: 'notify.channel.offers', descriptionKey: 'notify.channel.offers_desc', importance: 'MAX', sound: OFFER_SOUND, vibrationPattern: [0, 400, 200, 400, 200, 400], apps: ['partner', 'merchant'] },
  orders: { id: 'orders', nameKey: 'notify.channel.orders', importance: 'HIGH', sound: 'default', vibrationPattern: [0, 250], apps: ['customer', 'partner', 'merchant'] },
  chat: { id: 'chat', nameKey: 'notify.channel.chat', importance: 'HIGH', sound: 'default', vibrationPattern: [0, 150], apps: ['customer', 'partner', 'merchant'] },
  marketing: { id: 'marketing', nameKey: 'notify.channel.marketing', importance: 'LOW', sound: null, vibrationPattern: null, apps: ['customer'] },
};

// ───────────────────────── preferences ─────────────────────────

/**
 * Per-person switches. Safety alerts, OTP codes, partner offers / merchant new orders and money
 * messages (settlement, cap, cash receipts) ignore them: they always go out.
 */
export const NotifyPreferences = z.object({
  /** Push for order and ride status (accepted, on the way, delivered). */
  orderUpdates: z.boolean(),
  /** Push for in-order chat messages. */
  chat: z.boolean(),
  /** Receipts (order, top-up, الرجعة ticket) on WhatsApp. */
  whatsappReceipts: z.boolean(),
  /** The SMS twin of an important message whose push / WhatsApp did not arrive in time. */
  smsFallback: z.boolean(),
  /** Offers (push and WhatsApp): opt-in, at most 2 a week, never 23:00–08:00. */
  marketing: z.boolean(),
  /**
   * «قدر اليوم» (joy h2): a dish the person follows is today's pot. On by default — following the dish
   * is the opt-in; this switch silences all of them. Never 23:00–08:00, never on a quiet day, one a day.
   */
  dishPots: z.boolean(),
  /**
   * Joy r5: «تأكد رحلتك؟» for the person's own regular trips. On by default — saving the trip is the
   * opt-in; this switch silences the pushes (the app still asks). Never 23:00–08:00, never on a quiet day.
   */
  regularTrips: z.boolean(),
  /**
   * Step 4 (o4): «نفس مشوار البارحة؟» — a ride he took on most of the last working days, offered ten
   * minutes before his usual time. On by default, at most one a day; this switch silences it.
   */
  sameRide: z.boolean(),
});
export type NotifyPreferences = z.infer<typeof NotifyPreferences>;

export const DEFAULT_NOTIFY_PREFERENCES: NotifyPreferences = { orderUpdates: true, chat: true, whatsappReceipts: true, smsFallback: true, marketing: false, dishPots: true, regularTrips: true, sameRide: true };

export const SetNotifyPreferencesInput = NotifyPreferences.partial();
export type SetNotifyPreferencesInput = z.infer<typeof SetNotifyPreferencesInput>;

/** Quiet hours, Baghdad local time: marketing waits for the morning; everything else is sent. */
export const QUIET_HOURS = { startHour: 23, endHour: 8 } as const;
/** Marketing cap (domain §8): at most this many offers per person per rolling 7 days. */
export const MARKETING_MAX_PER_WEEK = 2;

// ───────────────────────── templates ─────────────────────────

/**
 * What a template is about; decides which preference governs it. `safety`, `otp`, `work` (job
 * offers, new orders) and `money` (settlement, cash receipts to partners and merchants) are never
 * switched off by a preference.
 */
export const NotifyCategory = z.enum(['otp', 'order_updates', 'chat', 'receipts', 'money', 'work', 'safety', 'marketing', 'dish_pot', 'regular_trip', 'same_ride']);
export type NotifyCategory = z.infer<typeof NotifyCategory>;

/**
 * Promotional in tone: held on quiet days and before iftar (`promoHold`), deferred in quiet hours.
 * Only `marketing` counts toward the weekly offer cap; `dish_pot` is one a day by its event key.
 * `regular_trip` (joy r5, the «تأكد رحلتك؟» reminder) follows the same quiet rules — the app still
 * shows the occurrence to confirm when the push is held — and is never counted in the cap.
 */
export const PROMOTIONAL_CATEGORIES: ReadonlySet<NotifyCategory> = new Set<NotifyCategory>(['marketing', 'dish_pot', 'regular_trip']);

export const NotifyTemplateId = z.enum([
  'order_accepted',
  'order_prep_extended',
  'order_late_apology',
  'order_picked_up',
  'courier_arriving',
  'courier_arriving_paid',
  'order_receipt',
  'ride_receipt',
  'ride_matched',
  'driver_arrived',
  'ride_near',
  'ride_safe_arrival',
  'phone_ride_matched',
  'phone_driver_arrived',
  'merchant_new_order',
  'partner_new_job',
  'partner_zone_nudge',
  'ride_nudge',
  'merchant_cash_handover',
  'menu_photos_ready',
  'courier_cash_receipt',
  'driver_pay_reply',
  'tip_received',
  'compliment_received',
  'driver_pay_resolved',
  'wallet_topup_receipt',
  'cash_change_credit',
  'order_late_credit',
  'rajaa_boarding_pass',
  'rajaa_pass_update',
  'khat_child_arrived',
  'khat_sweep_reminder',
  'khat_sweep_dispatch_alert',
  'sos_dispatch_alert',
  'sos_desk_ring',
  'sos_emergency_contact',
  'rajaa_arrived_contact',
  'trip_shared_contact',
  'ride_for_rider',
  'ride_rider_arrived',
  'chat_message',
  'marketing_offer',
  'dish_pot_today',
  'household_approval',
  'month_ready',
  'regular_trip_reminder',
  'ride_booked_reminder',
  'garage_taxi_late',
  'rajaa_rider_taxi_late',
  'garage_taxi_placed',
  'garage_taxi_dropped',
  'garage_taxi_failed',
  'same_ride_offer',
  'same_ride_after_weekend',
  'booked_ride_confirmed',
  'booked_ride_unconfirmed',
  'booked_ride_released',
  'booked_ride_searching',
  'ride_driver_cancelled',
  'ride_driver_cancelled_credit',
  'ride_no_driver',
  'partner_booked_offer',
  'partner_booked_favourite',
  'partner_booked_reminder',
  'partner_booked_cancelled',
  // W2 (CRIT1-01, NTF-03): the order's bad turns and the courier at the door reach the customer.
  'order_rejected',
  'order_kitchen_no_answer',
  'order_cancelled',
  'order_payer_declined',
  'order_payer_no_answer',
  'courier_at_door',
  'courier_unreachable',
  'courier_unreachable_reminder',
  'order_on_the_way',
  'order_partial_ask',
  'order_partial_no_answer',
  'order_rejected_credit',
  'support_reply',
  'support_refund',
  'support_resolved',
]);
export type NotifyTemplateId = z.infer<typeof NotifyTemplateId>;

/** A WhatsApp Business template: Meta name, language, the i18n text and its ordered parameters. */
export interface WhatsAppTemplateDef {
  /** Name registered with Meta (lowercase, underscores). */
  name: string;
  /** Meta template category. */
  metaCategory: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  /** Body text in both locales (`wa.*`, Meta's numbered `{{1}}` placeholders). */
  key: MessageKey;
  /** Param names in `{{n}}` order: params[0] fills {{1}}. Part of the template's contract. */
  params: readonly string[];
  /** One sample value per param, for the approval submission. */
  examples: readonly string[];
}

export interface NotifyTemplateDef {
  id: NotifyTemplateId;
  category: NotifyCategory;
  /** The app whose push tokens receive it; `any` = every app the person is signed in to. */
  app: NotifyApp | 'any';
  push?: {
    title: MessageKey;
    body: MessageKey;
    androidChannel: AndroidChannelId;
    /** Deep link with `{param}` placeholders (every notification opens its screen, domain §8). */
    deepLink: string;
    /**
     * Data-only: no title, body or sound reach the phone — the app reads `data` and updates something
     * it already shows (the الرجعة lock-screen card). Title and body still name it in the delivery log.
     */
    silent?: boolean;
  };
  whatsapp?: WhatsAppTemplateDef;
  /**
   * The SMS's own words (`sms.*` with `{name}` params) when SMS is a primary channel and says more than
   * the push (a link, a code), or when the person has no app at all (a ride booked by phone, step 4).
   * `withCode` is used instead when the `code` param is set. Absent: the SMS is the WhatsApp text,
   * else "title — body".
   */
  sms?: { key: MessageKey; withCode?: MessageKey };
  /** Channels attempted at once (subject to preferences). */
  primary: readonly NotifyChannel[];
  /**
   * The SMS twin: when none of the primary channels is confirmed delivered after this many seconds
   * (or every one failed or had nowhere to go), the same message goes by SMS. Absent: no twin.
   */
  smsTwinAfterSec?: number;
  /** `defer`: held until the end of quiet hours (marketing). `send`: any time. */
  quietHours: 'defer' | 'send';
}

const wa = (name: string, key: MessageKey, params: readonly string[], examples: readonly string[], metaCategory: WhatsAppTemplateDef['metaCategory'] = 'UTILITY'): WhatsAppTemplateDef => ({ name, key, params, examples, metaCategory });

/** WhatsApp falls back to SMS after 60 s undelivered (domain §8). */
export const WHATSAPP_SMS_FALLBACK_SEC = 60;

export const NOTIFY_TEMPLATES: Readonly<Record<NotifyTemplateId, NotifyTemplateDef>> = {
  order_accepted: {
    id: 'order_accepted',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_accepted.title', body: 'push.order_accepted.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // M-12: the kitchen used its one "+5 د"; the customer hears it from us, not from a late courier.
  order_prep_extended: {
    id: 'order_prep_extended',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_prep_extended.title', body: 'push.order_prep_extended.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // The honest-delay promise, step one (Ali, 2026-10-06): promised time + `MoneyRules.latePromise.apologyAfterMin`
  // and not at the door yet — one "آسفين" with the new time. SMS twin when the push is not delivered.
  order_late_apology: {
    id: 'order_late_apology',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_late_apology.title', body: 'push.order_late_apology.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  order_picked_up: {
    id: 'order_picked_up',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_picked_up.title', body: 'push.order_picked_up.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // W2: picked up when no arrival time can be read (no courier fix, no locked ride minutes) — never a made-up time.
  order_on_the_way: {
    id: 'order_on_the_way',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_on_the_way.title', body: 'push.order_on_the_way.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // W2 CRIT1-01: the kitchen said no, or never answered — told at once, with the way on (another kitchen).
  order_rejected: {
    id: 'order_rejected',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_rejected.title', body: 'push.order_rejected.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  // M-17 (Ali, 2026-10-08): the kitchen cancels after accepting — 500 دينار to his wallet, paid by the kitchen.
  order_rejected_credit: {
    id: 'order_rejected_credit',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_rejected_credit.title', body: 'push.order_rejected_credit.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  order_kitchen_no_answer: {
    id: 'order_kitchen_no_answer',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_kitchen_no_answer.title', body: 'push.order_kitchen_no_answer.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  // W2 BENCH-03: the kitchen has a dish out — he has 60 s to send the rest or cancel free. Push at once;
  // the SMS twin at 20 s still leaves time to open the app. Then, if no answer came, why it was cancelled.
  order_partial_ask: {
    id: 'order_partial_ask',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_partial_ask.title', body: 'push.order_partial_ask.body', androidChannel: 'orders', deepLink: 'driver://kitchen/{orderId}' },
    primary: ['push'],
    smsTwinAfterSec: 20,
    quietHours: 'send',
  },
  order_partial_no_answer: {
    id: 'order_partial_no_answer',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_partial_no_answer.title', body: 'push.order_partial_no_answer.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  // W2 CRIT1-01: we cancelled it (no answer on a changed order, ops); the household payer said no or never answered.
  order_cancelled: {
    id: 'order_cancelled',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_cancelled.title', body: 'push.order_cancelled.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  order_payer_declined: {
    id: 'order_payer_declined',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_payer_declined.title', body: 'push.order_payer_declined.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  order_payer_no_answer: {
    id: 'order_payer_no_answer',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.order_payer_no_answer.title', body: 'push.order_payer_no_answer.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  // W2 NTF-03: the courier is at the door. Then, if he can't reach the customer, the 5-minute clock is
  // never silent: push + WhatsApp at once, SMS when neither is delivered in 60 s, a reminder at minute 3.
  // Safety category: the customer can't turn these off (he is billed when the clock runs out).
  courier_at_door: {
    id: 'courier_at_door',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.courier_at_door.title', body: 'push.courier_at_door.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  courier_unreachable: {
    id: 'courier_unreachable',
    category: 'safety',
    app: 'customer',
    push: { title: 'push.unreachable.title', body: 'push.unreachable.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    whatsapp: wa('courier_unreachable', 'wa.courier_unreachable', ['courier'], ['حيدر']),
    primary: ['push', 'whatsapp'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  courier_unreachable_reminder: {
    id: 'courier_unreachable_reminder',
    category: 'safety',
    app: 'customer',
    push: { title: 'push.unreachable_reminder.title', body: 'push.unreachable_reminder.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    smsTwinAfterSec: 30,
    quietHours: 'send',
  },
  // W2 NTF-02: support's answer on a complaint reaches him (a chat case is answered in the chat itself).
  // `link` is the screen to open: `order/<id>` for an order's complaint, else `help`.
  support_reply: {
    id: 'support_reply',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.support_reply.title', body: 'push.support_reply.body', androidChannel: 'orders', deepLink: 'driver://{link}' },
    primary: ['push'],
    smsTwinAfterSec: 120,
    quietHours: 'defer',
  },
  support_refund: {
    id: 'support_refund',
    category: 'money',
    app: 'customer',
    push: { title: 'push.support_refund.title', body: 'push.support_refund.body', androidChannel: 'orders', deepLink: 'driver://{link}' },
    primary: ['push'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'defer',
  },
  support_resolved: {
    id: 'support_resolved',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.support_resolved.title', body: 'push.support_resolved.body', androidChannel: 'orders', deepLink: 'driver://{link}' },
    primary: ['push'],
    quietHours: 'defer',
  },
  courier_arriving: {
    id: 'courier_arriving',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.courier_arriving.title', body: 'push.courier_arriving.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    whatsapp: wa('courier_arriving', 'wa.courier_arriving', ['name', 'courier', 'merchant', 'amount'], ['علي', 'حيدر', 'مطعم خالد', '12,500']),
    primary: ['push', 'whatsapp'],
    quietHours: 'send',
  },
  // NTF-21: the same moment for an order already paid (wallet, prepaid) — no «جهّز الكاش».
  courier_arriving_paid: {
    id: 'courier_arriving_paid',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.courier_arriving.title', body: 'push.courier_arriving_paid.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    whatsapp: wa('courier_arriving_paid', 'wa.courier_arriving_paid', ['name', 'courier', 'merchant'], ['علي', 'حيدر', 'مطعم خالد']),
    primary: ['push', 'whatsapp'],
    quietHours: 'send',
  },
  order_receipt: {
    id: 'order_receipt',
    category: 'receipts',
    app: 'customer',
    push: { title: 'push.order_delivered.title', body: 'push.order_delivered.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    whatsapp: wa('order_receipt', 'wa.order_delivered', ['merchant', 'amount', 'receiptUrl'], ['مطعم خالد', '12,500', 'https://driver.iq/r/ord_123']),
    primary: ['push', 'whatsapp'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  ride_receipt: {
    id: 'ride_receipt',
    category: 'receipts',
    app: 'customer',
    push: { title: 'push.ride_completed.title', body: 'push.ride_completed.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    whatsapp: wa('ride_receipt', 'wa.trip_completed', ['amount', 'driver', 'receiptUrl'], ['4,000', 'حيدر', 'https://driver.iq/r/ord_123']),
    primary: ['push', 'whatsapp'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  // J1c f4: the two ride peaks reach a phone in a pocket (the app plays them as moments when open).
  ride_matched: {
    id: 'ride_matched',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.ride_matched.title', body: 'push.ride_matched.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  driver_arrived: {
    id: 'driver_arrived',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.driver_arrived.title', body: 'push.driver_arrived.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // d3: «السايق قريب، اطلع هسة» — once per ride, when the one ETA puts him a minute from the pickup.
  ride_near: {
    id: 'ride_near',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.ride_near.title', body: 'push.ride_near.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // s2 «وصل بالسلامة»: a night city ride ended — each trusted person of the rider who has the app.
  // In the app only (a push to their own account); nothing goes to a number outside it.
  ride_safe_arrival: {
    id: 'ride_safe_arrival',
    category: 'safety',
    app: 'customer',
    push: { title: 'push.ride_safe_arrival.title', body: 'push.ride_safe_arrival.body', androidChannel: 'orders', deepLink: 'driver://' },
    primary: ['push'],
    quietHours: 'send',
  },
  // Taxi/tuktuk step 4 (v4): a ride booked by phone from the Console. The caller has no app, so the
  // driver's name, car, plate, minutes away and the trip link go by SMS; then «وصل» at the pickup.
  phone_ride_matched: {
    id: 'phone_ride_matched',
    category: 'order_updates',
    app: 'customer',
    sms: { key: 'sms.phone_ride_matched' },
    primary: ['sms'],
    quietHours: 'send',
  },
  phone_driver_arrived: {
    id: 'phone_driver_arrived',
    category: 'order_updates',
    app: 'customer',
    sms: { key: 'sms.phone_driver_arrived' },
    primary: ['sms'],
    quietHours: 'send',
  },
  merchant_new_order: {
    id: 'merchant_new_order',
    category: 'work',
    app: 'merchant',
    push: { title: 'push.merchant_new_order.title', body: 'push.merchant_new_order.body', androidChannel: 'offers', deepLink: 'driver-merchant://order/{orderId}' },
    primary: ['push'],
    // Domain §8: "push + loud alert + optional SMS" — the SMS goes when the push is not confirmed in 30 s.
    smsTwinAfterSec: 30,
    quietHours: 'send',
  },
  partner_new_job: {
    id: 'partner_new_job',
    category: 'work',
    app: 'partner',
    push: { title: 'push.partner_new_job.title', body: 'push.partner_offer.body', androidChannel: 'offers', deepLink: 'driver-partner://offer' },
    primary: ['push'],
    quietHours: 'send',
  },
  /** "Send drivers here" (maps program o5): free drivers around a zone the Console saw busy. */
  partner_zone_nudge: {
    id: 'partner_zone_nudge',
    category: 'work',
    app: 'partner',
    push: { title: 'push.partner_zone_nudge.title', body: 'push.partner_zone_nudge.body', androidChannel: 'orders', deepLink: 'driver-partner://' },
    primary: ['push'],
    quietHours: 'send',
  },
  // «نبّهه» (ride step 3, n4): the rider waiting on a ride he was sent nudged him — soft, on the
  // quiet `orders` channel (the offer itself already rang on `offers`); opens the offer.
  ride_nudge: {
    id: 'ride_nudge',
    category: 'work',
    app: 'partner',
    push: { title: 'push.ride_nudge.title', body: 'push.ride_nudge.body', androidChannel: 'orders', deepLink: 'driver-partner://offer' },
    primary: ['push'],
    quietHours: 'send',
  },
  // «عندي اعتراض» answered (partner audit S-7 follow-up): support replied to, or settled, the driver's
  // objection on one job's pay; the push opens that job's receipt with the reply on it.
  // «علي كرمك 1,000 دينار» (Ali, 2026-10-06): the customer tipped after a 4–5 rating; 100 % his.
  tip_received: {
    id: 'tip_received',
    category: 'money',
    app: 'partner',
    push: { title: 'push.tip_received.title', body: 'push.tip_received.body', androidChannel: 'orders', deepLink: 'driver-partner://earnings' },
    primary: ['push'],
    quietHours: 'send',
  },
  // «زينب قالتلك: سريع، مؤدب» (joy l4): a customer's kind words after a 4–5 rating; opens «كلام الزبائن».
  // Held through quiet hours: nice news, never worth waking him.
  compliment_received: {
    id: 'compliment_received',
    category: 'work',
    app: 'partner',
    push: { title: 'push.compliment_received.title', body: 'push.compliment_received.body', androidChannel: 'orders', deepLink: 'driver-partner://compliments' },
    primary: ['push'],
    quietHours: 'defer',
  },
  driver_pay_reply: {
    id: 'driver_pay_reply',
    category: 'money',
    app: 'partner',
    push: { title: 'push.driver_pay_reply.title', body: 'push.driver_pay_reply.body', androidChannel: 'orders', deepLink: 'driver-partner://earnings/receipt?key={key}&at={at}' },
    primary: ['push'],
    quietHours: 'send',
  },
  driver_pay_resolved: {
    id: 'driver_pay_resolved',
    category: 'money',
    app: 'partner',
    push: { title: 'push.driver_pay_resolved.title', body: 'push.driver_pay_resolved.body', androidChannel: 'orders', deepLink: 'driver-partner://earnings/receipt?key={key}&at={at}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // Menu photo service (maps k3): field ops handed the visit's photos over; the owner accepts or
  // rejects each one on «تصوير المنيو». Push only: nothing here is worth a paid WhatsApp template.
  menu_photos_ready: {
    id: 'menu_photos_ready',
    category: 'work',
    app: 'merchant',
    push: { title: 'push.menu_photos_ready.title', body: 'push.menu_photos_ready.body', androidChannel: 'orders', deepLink: 'driver-merchant://menu-photos' },
    primary: ['push'],
    quietHours: 'send',
  },
  merchant_cash_handover: {
    id: 'merchant_cash_handover',
    category: 'money',
    app: 'merchant',
    push: { title: 'push.merchant_cash_handover.title', body: 'push.merchant_cash_handover.body', androidChannel: 'orders', deepLink: 'driver-merchant://money' },
    whatsapp: wa('merchant_cash_handover', 'wa.merchant_cash_handover', ['store', 'amount', 'courier', 'date', 'balance', 'reference'], ['مطعم خالد', '45,000', 'حيدر', '2026-10-04', '0', 'MH-2610-0001']),
    primary: ['push', 'whatsapp'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  courier_cash_receipt: {
    id: 'courier_cash_receipt',
    category: 'money',
    app: 'partner',
    push: { title: 'push.partner_cash_received.title', body: 'push.partner_cash_received.body', androidChannel: 'orders', deepLink: 'driver-partner://earnings' },
    whatsapp: wa('courier_cash_receipt', 'wa.partner_settlement_receipt', ['amount', 'date', 'balance'], ['60,000', '2026-10-04', '-15,000']),
    primary: ['push', 'whatsapp'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  // "الخردة علينا" (Phase 3): the courier had no change, the rest of the customer's note is in his wallet.
  cash_change_credit: {
    id: 'cash_change_credit',
    category: 'receipts',
    app: 'customer',
    push: { title: 'push.cash_change_credit.title', body: 'push.cash_change_credit.body', androidChannel: 'orders', deepLink: 'driver://wallet' },
    primary: ['push'],
    quietHours: 'send',
  },
  // NTF-22: the honest-delay credit (step two) is in his wallet — told like the change credit above.
  order_late_credit: {
    id: 'order_late_credit',
    category: 'receipts',
    app: 'customer',
    push: { title: 'push.order_late_credit.title', body: 'push.order_late_credit.body', androidChannel: 'orders', deepLink: 'driver://wallet' },
    primary: ['push'],
    quietHours: 'send',
  },
  wallet_topup_receipt: {
    id: 'wallet_topup_receipt',
    category: 'receipts',
    app: 'customer',
    push: { title: 'push.topup_done.title', body: 'push.topup_done.body', androidChannel: 'orders', deepLink: 'driver://wallet' },
    whatsapp: wa('wallet_topup_receipt', 'wa.topup_receipt', ['amount', 'date', 'reference'], ['25,000', '2026-10-04', 'TU-2610-0007']),
    primary: ['push', 'whatsapp'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  // The lock-screen boarding pass kept current with the app closed (customer d-8 follow-up): a data-only
  // push per boarding moment; the app re-posts the Android ongoing card from it (`RajaaPassPush`).
  rajaa_pass_update: {
    id: 'rajaa_pass_update',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.rajaa_pass_update.title', body: 'push.rajaa_pass_update.body', androidChannel: 'orders', deepLink: 'driver://rajaa/pass/{bookingId}', silent: true },
    primary: ['push'],
    quietHours: 'send',
  },
  rajaa_boarding_pass: {
    id: 'rajaa_boarding_pass',
    category: 'receipts',
    app: 'customer',
    push: { title: 'push.seat_booked.title', body: 'push.seat_booked.body', androidChannel: 'orders', deepLink: 'driver://rajaa/pass/{bookingId}' },
    whatsapp: wa('rajaa_boarding_pass', 'wa.rajaa_boarding_pass', ['route', 'date', 'time', 'seat', 'vehicle', 'place', 'pin'], ['العزيزية ← بغداد', '2026-10-05', '7:30', 'A1', 'كيا بونگو · 12345 واسط', 'كراج البوابة 1', '4821']),
    primary: ['push', 'whatsapp'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  khat_child_arrived: {
    id: 'khat_child_arrived',
    category: 'safety',
    app: 'customer',
    push: { title: 'push.khat_dropped.title', body: 'push.khat_dropped.body', androidChannel: 'orders', deepLink: 'driver://' },
    whatsapp: wa('khat_child_arrived', 'wa.khat_dropped', ['child', 'place', 'time'], ['زينب', 'مدرسة الرافدين', '7:40']),
    primary: ['push', 'whatsapp'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  // The sweep nobody did (partner S-6, Ali 2026-10-06): the run's driver, the moment ops are alerted.
  khat_sweep_reminder: {
    id: 'khat_sweep_reminder',
    category: 'safety',
    app: 'partner',
    push: { title: 'push.khat_sweep_reminder.title', body: 'push.khat_sweep_reminder.body', androidChannel: 'offers', deepLink: 'driver-partner://khat' },
    primary: ['push'],
    quietHours: 'send',
  },
  // The sweep nobody did, for ops (Ali, 2026-10-06): paged like SOS (every on-shift dispatcher and
  // admin, loud push + WhatsApp) one step lower: the usual 60-s SMS twin and no escalation. No child's name.
  khat_sweep_dispatch_alert: {
    id: 'khat_sweep_dispatch_alert',
    category: 'safety',
    app: 'any',
    push: { title: 'push.khat_sweep_dispatch.title', body: 'push.khat_sweep_dispatch.body', androidChannel: 'offers', deepLink: 'driver://safety' },
    whatsapp: wa('khat_sweep_dispatch_alert', 'wa.khat_sweep_dispatch', ['name', 'route', 'minutes', 'link'], ['حيدر ك.', '#4821', '5 دقايق', 'https://console.driver.iq/safety']),
    primary: ['push', 'whatsapp'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  // SOS (scoring & safety §3): every on-shift dispatcher and admin, loud, on every channel.
  sos_dispatch_alert: {
    id: 'sos_dispatch_alert',
    category: 'safety',
    app: 'any',
    push: { title: 'push.sos_dispatch.title', body: 'push.sos_dispatch.body', androidChannel: 'offers', deepLink: 'driver://safety/{incidentId}' },
    whatsapp: wa('sos_dispatch_alert', 'wa.sos_dispatch', ['name', 'role', 'what', 'link'], ['حيدر ك.', 'سايق', 'مشوار تكتك #1290', 'https://console.driver.iq/safety/sos_123']),
    primary: ['push', 'whatsapp'],
    smsTwinAfterSec: 30,
    quietHours: 'send',
  },
  // SOS ladder (Console E1, CON-02): nobody took it yet, so the desk is rung again every 30 s. Push
  // only and never an SMS twin (the on-call step at 60 s carries WhatsApp and SMS).
  sos_desk_ring: {
    id: 'sos_desk_ring',
    category: 'safety',
    app: 'any',
    push: { title: 'push.sos_ring.title', body: 'push.sos_ring.body', androidChannel: 'offers', deepLink: 'driver://safety/{incidentId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // SOS: the pressing person's emergency contact (a number, not an account): WhatsApp, SMS after 30 s.
  sos_emergency_contact: {
    id: 'sos_emergency_contact',
    category: 'safety',
    app: 'customer',
    whatsapp: wa('sos_emergency_contact', 'wa.sos_contact', ['name', 'link'], ['علي', 'https://driver.iq/sos/abc.def']),
    primary: ['whatsapp'],
    smsTwinAfterSec: 30,
    quietHours: 'send',
  },
  // Joy r2 + w9 «بلّغهم من أوصل»: each trusted person (a number, not an account) when the rider's
  // الرجعة trip arrives. Gender-free: «رحلة زينب (بغداد ← العزيزية) وصلت بالسلامة الساعة 7:42 المسا».
  rajaa_arrived_contact: {
    id: 'rajaa_arrived_contact',
    category: 'safety',
    app: 'customer',
    whatsapp: wa('rajaa_arrived_contact', 'wa.rajaa_arrived_contact', ['name', 'route', 'time'], ['زينب', 'بغداد ← العزيزية', '7:42 المسا']),
    primary: ['whatsapp'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  // Joy w9 auto-share: a الرجعة trip at boarding, a taxi/tuktuk ride at night once a driver took it.
  trip_shared_contact: {
    id: 'trip_shared_contact',
    category: 'safety',
    app: 'customer',
    whatsapp: wa('trip_shared_contact', 'wa.trip_shared_contact', ['name', 'what', 'link'], ['زينب', 'الرجعة بغداد ← العزيزية', 'https://driver.iq/share/shr_abc']),
    primary: ['whatsapp'],
    smsTwinAfterSec: WHATSAPP_SMS_FALLBACK_SEC,
    quietHours: 'send',
  },
  // Ride ideas c9/s3: a ride booked for someone else — once a driver takes it, the rider (a number, often
  // not an account) gets who is coming and the live link by SMS, and a push too when the number has the
  // app. The night ride's start code goes in it: the rider is the one getting in.
  ride_for_rider: {
    id: 'ride_for_rider',
    category: 'safety',
    app: 'customer',
    push: { title: 'push.ride_for_rider.title', body: 'push.ride_for_rider.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    sms: { key: 'sms.ride_for_rider', withCode: 'sms.ride_for_rider_code' },
    primary: ['push', 'sms'],
    quietHours: 'send',
  },
  // Ride idea s3: the booker followed it to the end — «مشوار ماما وصل بالسلامة» (the مشوار arrives: gender-free).
  ride_rider_arrived: {
    id: 'ride_rider_arrived',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.ride_rider_arrived.title', body: 'push.ride_rider_arrived.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  chat_message: {
    id: 'chat_message',
    category: 'chat',
    app: 'any',
    push: { title: 'push.chat_message.title_support', body: 'push.chat_message.photo', androidChannel: 'chat', deepLink: 'driver://chat/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  marketing_offer: {
    id: 'marketing_offer',
    category: 'marketing',
    app: 'customer',
    push: { title: 'push.promo.title', body: 'push.promo.body', androidChannel: 'marketing', deepLink: 'driver://home' },
    primary: ['push'],
    quietHours: 'defer',
  },
  // Joy h2: a dish the person follows is a kitchen's «قدر اليوم» (one a day at most, quiet on quiet days).
  dish_pot_today: {
    id: 'dish_pot_today',
    category: 'dish_pot',
    app: 'customer',
    push: { title: 'push.dish_pot.title', body: 'push.dish_pot.body', androidChannel: 'marketing', deepLink: 'driver://restaurant/{merchantOrgId}' },
    primary: ['push'],
    quietHours: 'defer',
  },
  // Joy w4: an order on the household wallet over a limit waits for the payer's yes.
  household_approval: {
    id: 'household_approval',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.household_approval.title', body: 'push.household_approval.body', androidChannel: 'orders', deepLink: 'driver://household' },
    primary: ['push'],
    quietHours: 'send',
  },
  // Joy w6: «شهرك» on the 1st — a gentle card, marketing (only with marketing on, quiet days and hours respected).
  month_ready: {
    id: 'month_ready',
    category: 'marketing',
    app: 'customer',
    push: { title: 'push.month_ready.title', body: 'push.month_ready.body', androidChannel: 'marketing', deepLink: 'driver://month?month={month}' },
    primary: ['push'],
    quietHours: 'defer',
  },
  // Joy r5: a regular trip asks the evening before (or that morning); only «أكدها» books it.
  regular_trip_reminder: {
    id: 'regular_trip_reminder',
    category: 'regular_trip',
    app: 'customer',
    push: { title: 'push.regular_trip.title', body: 'push.regular_trip.body', androidChannel: 'orders', deepLink: 'driver://regular/{regularTripId}?date={day}' },
    primary: ['push'],
    quietHours: 'defer',
  },
  // Step 4 (c10): half an hour before a ride booked for later, a quarter before the search starts. His
  // own booking at the hour he chose, so it goes in quiet hours too (a 6:30 reminder for a 7:00 ride).
  ride_booked_reminder: {
    id: 'ride_booked_reminder',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.ride_booked.title', body: 'push.ride_booked.body', androidChannel: 'orders', deepLink: 'driver://ride/booked/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // Taxi idea x3: the taxi we sent to his الرجعة car is running late — he hears the minutes and that
  // the car's driver was told. His own trip, now: sent in quiet hours too.
  garage_taxi_late: {
    id: 'garage_taxi_late',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.garage_taxi_late.title', body: 'push.garage_taxi_late.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // x3, the الرجعة driver's side: his rider on seat X is coming in our taxi, N minutes late; opens the departure.
  rajaa_rider_taxi_late: {
    id: 'rajaa_rider_taxi_late',
    category: 'work',
    app: 'partner',
    push: { title: 'push.rajaa_rider_taxi_late.title', body: 'push.rajaa_rider_taxi_late.body', androidChannel: 'orders', deepLink: 'driver-partner://intercity/departure/{departureId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // x4 / n10: the car is ~10 minutes from the Aziziyah garage and the server booked his waiting taxi.
  garage_taxi_placed: {
    id: 'garage_taxi_placed',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.garage_taxi_placed.title', body: 'push.garage_taxi_placed.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // x4: the trip was cancelled, so the armed taxi was dropped (nothing was booked, nothing to pay).
  garage_taxi_dropped: {
    id: 'garage_taxi_dropped',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.garage_taxi_dropped.title', body: 'push.garage_taxi_dropped.body', androidChannel: 'orders', deepLink: 'driver://rajaa/pass/{bookingId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // x4: the server could not book it (a cash limit, the city paused…): he books it himself, one tap.
  garage_taxi_failed: {
    id: 'garage_taxi_failed',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.garage_taxi_failed.title', body: 'push.garage_taxi_failed.body', androidChannel: 'orders', deepLink: 'driver://ride' },
    primary: ['push'],
    quietHours: 'send',
  },
  // Step 4 (o4): «نفس مشوار البارحة؟» ten minutes before his usual time — the hour he rides at, so not
  // held for quiet hours; its own switch, one a day by its event key. The link opens choose filled in.
  same_ride_offer: {
    id: 'same_ride_offer',
    category: 'same_ride',
    app: 'customer',
    push: { title: 'push.same_ride.title', body: 'push.same_ride.body', androidChannel: 'orders', deepLink: 'driver://ride/again?from={from}&to={to}&v={vertical}&door={door}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // The same on Sunday: his last working day was Thursday («نفس مشوار الخميس؟»).
  same_ride_after_weekend: {
    id: 'same_ride_after_weekend',
    category: 'same_ride',
    app: 'customer',
    push: { title: 'push.same_ride.title_weekend', body: 'push.same_ride.body', androidChannel: 'orders', deepLink: 'driver://ride/again?from={from}&to={to}&v={vertical}&door={door}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // Review #28, the rider of a ride booked for later: «سايقك محجوز: حسين» when a driver confirms; at the
  // deadline with nobody, a calm «نلگيلك سايق قبل وكتك»; when the confirmed one drops it. Good news or no
  // news yet: held through quiet hours, never waking him.
  booked_ride_confirmed: {
    id: 'booked_ride_confirmed',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.booked_confirmed.title', body: 'push.booked_confirmed.body', androidChannel: 'orders', deepLink: 'driver://ride/booked/{orderId}' },
    primary: ['push'],
    quietHours: 'defer',
  },
  booked_ride_unconfirmed: {
    id: 'booked_ride_unconfirmed',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.booked_unconfirmed.title', body: 'push.booked_unconfirmed.body', androidChannel: 'orders', deepLink: 'driver://ride/booked/{orderId}' },
    primary: ['push'],
    quietHours: 'defer',
  },
  // NTF-05: T−30, the search for the driver of a ride booked for later starts now (his own ride, soon: any hour).
  booked_ride_searching: {
    id: 'booked_ride_searching',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.booked_searching.title', body: 'push.booked_searching.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // NTF-04: the driver who took the ride cancelled; the ride is back in the search. Any hour: he may be at the curb.
  ride_driver_cancelled: {
    id: 'ride_driver_cancelled',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.ride_driver_cancelled.title', body: 'push.ride_driver_cancelled.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // M-15: the same, after he reached the pickup — the orderer also hears the credit in his wallet.
  ride_driver_cancelled_credit: {
    id: 'ride_driver_cancelled_credit',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.ride_driver_cancelled.title', body: 'push.ride_driver_cancelled.body_credit', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  // NTF-04: no driver took it by the free-cancel time: wait, cancel free, or book for later.
  ride_no_driver: {
    id: 'ride_no_driver',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.ride_no_driver.title', body: 'push.ride_no_driver.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    primary: ['push'],
    quietHours: 'send',
  },
  booked_ride_released: {
    id: 'booked_ride_released',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.booked_released.title', body: 'push.booked_released.body', androidChannel: 'orders', deepLink: 'driver://ride/booked/{orderId}' },
    primary: ['push'],
    quietHours: 'defer',
  },
  // Review #28, drivers: a booked ride open to confirm in «مشاوير باچر» (the favourite's own, or the best
  // placed fitting drivers once it opens to all) — held through quiet hours like any nice news; the
  // reminder an hour before and a cancellation of a job he holds go out at any hour (he committed to it).
  partner_booked_offer: {
    id: 'partner_booked_offer',
    category: 'work',
    app: 'partner',
    push: { title: 'push.partner_booked_offer.title', body: 'push.partner_booked_offer.body', androidChannel: 'orders', deepLink: 'driver-partner://booked' },
    primary: ['push'],
    quietHours: 'defer',
  },
  partner_booked_favourite: {
    id: 'partner_booked_favourite',
    category: 'work',
    app: 'partner',
    push: { title: 'push.partner_booked_favourite.title', body: 'push.partner_booked_favourite.body', androidChannel: 'orders', deepLink: 'driver-partner://booked' },
    primary: ['push'],
    quietHours: 'defer',
  },
  partner_booked_reminder: {
    id: 'partner_booked_reminder',
    category: 'work',
    app: 'partner',
    push: { title: 'push.partner_booked_reminder.title', body: 'push.partner_booked_reminder.body', androidChannel: 'offers', deepLink: 'driver-partner://booked' },
    primary: ['push'],
    quietHours: 'send',
  },
  partner_booked_cancelled: {
    id: 'partner_booked_cancelled',
    category: 'work',
    app: 'partner',
    push: { title: 'push.partner_booked_cancelled.title', body: 'push.partner_booked_cancelled.body', androidChannel: 'orders', deepLink: 'driver-partner://booked' },
    primary: ['push'],
    quietHours: 'send',
  },
};

/** Categories a preference can switch off, and which switch. */
export function preferenceFor(category: NotifyCategory, channel: NotifyChannel): keyof NotifyPreferences | null {
  if (category === 'marketing') return 'marketing';
  if (category === 'dish_pot') return 'dishPots';
  if (category === 'regular_trip') return 'regularTrips';
  if (category === 'same_ride') return 'sameRide';
  if ((category === 'order_updates' || category === 'receipts') && channel === 'push') return 'orderUpdates';
  if (category === 'chat') return 'chat';
  if (category === 'receipts' && channel === 'whatsapp') return 'whatsappReceipts';
  if ((category === 'receipts' || category === 'order_updates') && channel === 'sms') return 'smsFallback';
  return null;
}

/** OTP over WhatsApp (domain §8 "SMS, WhatsApp fallback"): an AUTHENTICATION template, listed for approval. */
export const WHATSAPP_OTP_TEMPLATE: WhatsAppTemplateDef = wa('driver_otp', 'wa.otp', ['code'], ['482915'], 'AUTHENTICATION');

// ───────────────────────── device registration ─────────────────────────

export const RegisterDeviceInput = z.object({
  token: z.string().min(8).max(512),
  kind: PushTokenKind.default('expo'),
  app: NotifyApp,
  platform: PushPlatform,
  appVersion: z.string().max(40).optional(),
});
export type RegisterDeviceInput = z.infer<typeof RegisterDeviceInput>;

export const UnregisterDeviceInput = z.object({ token: z.string().min(8).max(512) });
export type UnregisterDeviceInput = z.infer<typeof UnregisterDeviceInput>;

export const RegisterDeviceOutput = z.object({ registered: z.boolean() });
export type RegisterDeviceOutput = z.infer<typeof RegisterDeviceOutput>;

/** The app opened (or received in the foreground) a push: confirms delivery for the SMS-twin rule. */
export const AckDeliveryInput = z.object({ deliveryId: z.string().min(1), opened: z.boolean().default(false) });
export type AckDeliveryInput = z.infer<typeof AckDeliveryInput>;

// ───────────────────────── delivery log ─────────────────────────

/**
 * `queued` → `sent` (provider accepted) → `delivered` (provider receipt / WhatsApp status / app
 * ack) → `read` (opened). `deferred`: waiting for quiet hours to end. `suppressed`: a preference,
 * the marketing cap or a duplicate stopped it. `skipped`: nowhere to send (no device, no phone).
 */
export const DeliveryStatus = z.enum(['queued', 'deferred', 'sent', 'delivered', 'read', 'failed', 'suppressed', 'skipped']);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

export const DeliveryLogRow = z.object({
  id: z.string(),
  eventId: z.string(),
  template: NotifyTemplateId,
  personId: z.string(),
  orderId: z.string().nullable(),
  channel: NotifyChannel,
  status: DeliveryStatus,
  reason: z.string().nullable(),
  provider: z.string().nullable(),
  attempts: z.number().int(),
  /** Set on an SMS twin: the template it stands in for was not delivered in time. */
  twin: z.boolean(),
  /** What was sent (Arabic title / body or the WhatsApp template name); never the phone number. */
  title: z.string().nullable(),
  body: z.string().nullable(),
  createdAt: z.coerce.date(),
  sentAt: z.coerce.date().nullable(),
  deliveredAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date(),
});
export type DeliveryLogRow = z.infer<typeof DeliveryLogRow>;

export const NotifyLogInput = z
  .object({
    personId: z.string().min(1).optional(),
    orderId: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .refine((v) => Boolean(v.personId ?? v.orderId), { message: 'personId or orderId' });
export type NotifyLogInput = z.infer<typeof NotifyLogInput>;

/**
 * "خبرني" on the home's coming-soon tiles (customer C-03): a person asks to be told when a service
 * opens. One row per person and service (asking again only refreshes it); the Console reads the
 * counts per service and zone (`notify.launchDemand`) to decide where to open first.
 */
export const LaunchService = z.enum(['grocery', 'khat', 'parcel']);
export type LaunchService = z.infer<typeof LaunchService>;

export const LaunchInterestInput = z.object({
  service: LaunchService,
  /** The zone of the person's deliver-to place, when they have one (demand by area). */
  zoneKey: z.string().min(1).max(40).optional(),
});
export type LaunchInterestInput = z.infer<typeof LaunchInterestInput>;

export const MyLaunchInterests = z.object({ services: z.array(LaunchService) });
export type MyLaunchInterests = z.infer<typeof MyLaunchInterests>;

export const LaunchDemandRow = z.object({
  service: LaunchService,
  people: z.number().int().min(0),
  /** Most-asked zones first; people without a place count under `null`. */
  byZone: z.array(z.object({ zoneKey: z.string().nullable(), people: z.number().int().min(0) })),
  lastAt: z.coerce.date().nullable(),
});
export type LaunchDemandRow = z.infer<typeof LaunchDemandRow>;

export interface NotifyPort {
  registerDevice(actor: Actor, input: RegisterDeviceInput): Promise<RegisterDeviceOutput>;
  unregisterDevice(actor: Actor, input: UnregisterDeviceInput): Promise<RegisterDeviceOutput>;
  preferences(actor: Actor): Promise<NotifyPreferences>;
  setPreferences(actor: Actor, input: SetNotifyPreferencesInput): Promise<NotifyPreferences>;
  ack(actor: Actor, input: AckDeliveryInput): Promise<{ ok: boolean }>;
  /** Support / dispatch: deliveries for a person or an order, newest first. */
  log(actor: Actor, input: NotifyLogInput): Promise<DeliveryLogRow[]>;
  /** "خبرني لمن ينفتح": records (or refreshes) this person's interest in a coming-soon service. */
  launchInterest(actor: Actor, input: LaunchInterestInput): Promise<MyLaunchInterests>;
  /** The services this person asked about (the sheet says "راح نخبرك"). */
  myLaunchInterests(actor: Actor): Promise<MyLaunchInterests>;
  /** Console: how many people asked for each coming-soon service, by zone. */
  launchDemand(actor: Actor): Promise<LaunchDemandRow[]>;
}
