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
});
export type NotifyPreferences = z.infer<typeof NotifyPreferences>;

export const DEFAULT_NOTIFY_PREFERENCES: NotifyPreferences = { orderUpdates: true, chat: true, whatsappReceipts: true, smsFallback: true, marketing: false };

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
export const NotifyCategory = z.enum(['otp', 'order_updates', 'chat', 'receipts', 'money', 'work', 'safety', 'marketing']);
export type NotifyCategory = z.infer<typeof NotifyCategory>;

export const NotifyTemplateId = z.enum([
  'order_accepted',
  'order_prep_extended',
  'order_late_apology',
  'order_picked_up',
  'courier_arriving',
  'order_receipt',
  'ride_receipt',
  'ride_matched',
  'driver_arrived',
  'merchant_new_order',
  'partner_new_job',
  'partner_zone_nudge',
  'merchant_cash_handover',
  'courier_cash_receipt',
  'wallet_topup_receipt',
  'cash_change_credit',
  'rajaa_boarding_pass',
  'khat_child_arrived',
  'khat_sweep_reminder',
  'khat_sweep_dispatch_alert',
  'sos_dispatch_alert',
  'sos_emergency_contact',
  'chat_message',
  'marketing_offer',
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
  };
  whatsapp?: WhatsAppTemplateDef;
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
  courier_arriving: {
    id: 'courier_arriving',
    category: 'order_updates',
    app: 'customer',
    push: { title: 'push.courier_arriving.title', body: 'push.courier_arriving.body', androidChannel: 'orders', deepLink: 'driver://order/{orderId}' },
    whatsapp: wa('courier_arriving', 'wa.courier_arriving', ['name', 'courier', 'merchant', 'amount'], ['علي', 'حيدر', 'مطعم خالد', '12,500']),
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
};

/** Categories a preference can switch off, and which switch. */
export function preferenceFor(category: NotifyCategory, channel: NotifyChannel): keyof NotifyPreferences | null {
  if (category === 'marketing') return 'marketing';
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
