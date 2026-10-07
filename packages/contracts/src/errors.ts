import { z } from 'zod';
import { hasKey, t, type MessageKey } from '@driver/i18n';

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

/**
 * A code's behaviour. Its words live in packages/i18n (audit S-08), so they go through the voice
 * test like every other string: the key is `error.<code>` unless `i18n` names a shared one.
 */
interface ErrorDef {
  /** Locale key when it is not `error.<code>` (a string the apps already show for the same case). */
  i18n?: MessageKey;
  /**
   * @deprecated Only a stop-gap while a new code's `error.<code>` key is being added: the table test
   * fails on it. Write the Arabic in packages/i18n/src/locales/ar-IQ.json (and en.json) instead.
   */
  message_ar?: string;
  /** @deprecated See `message_ar`. */
  message_en?: string;
  retryHint: RetryHint;
  /** tRPC / HTTP class the transport maps the code to. */
  status: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'TOO_MANY_REQUESTS' | 'INTERNAL_SERVER_ERROR';
}

/** Stable error-code table. Add codes here, never as ad-hoc strings in a service. */
export const ERROR_TABLE = {
  // transport / generic
  unauthorized: { i18n: 'error.session_expired', retryHint: 'never', status: 'UNAUTHORIZED' },
  forbidden: { retryHint: 'never', status: 'FORBIDDEN' },
  not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  invalid_input: { retryHint: 'never', status: 'BAD_REQUEST' },
  internal: { i18n: 'error.server', retryHint: 'later', status: 'INTERNAL_SERVER_ERROR' },
  dev_only: { retryHint: 'never', status: 'FORBIDDEN' },

  // partner & merchant wave 2 (driverAccount, khat, fleet, ops, merchantAdmin)
  document_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  checkin_challenge_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  checkin_locked: { retryHint: 'support', status: 'FORBIDDEN' },
  // partner.goOnline refused by the online gate (scoring §2: daily check-in, expired documents → offline)
  online_checkin_required: { retryHint: 'never', status: 'FORBIDDEN' },
  online_document_expired: { retryHint: 'never', status: 'FORBIDDEN' },
  // partner.goOnline: the vehicle is the registered one, and it has to fit his roles (backend review 2026-10-04 #20)
  vehicle_not_registered: { retryHint: 'support', status: 'FORBIDDEN' },
  khat_not_child_stop: { retryHint: 'never', status: 'BAD_REQUEST' },
  khat_child_not_on_trip: { retryHint: 'never', status: 'NOT_FOUND' },
  khat_child_not_tapped_in: { retryHint: 'never', status: 'CONFLICT' },
  // s1 «رمز المشوار»: a night ride starts only with the 4 digits the rider reads out
  start_code_required: { retryHint: 'never', status: 'BAD_REQUEST' },
  start_code_wrong: { retryHint: 'now', status: 'BAD_REQUEST' },
  khat_child_absent: { retryHint: 'never', status: 'CONFLICT' },
  // khat.confirmEmptyCar before every child stop is settled (partner S-6 sweep)
  khat_run_not_finished: { retryHint: 'never', status: 'CONFLICT' },
  fleet_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  fleet_ambiguous: { retryHint: 'never', status: 'BAD_REQUEST' },
  vehicle_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  vehicle_plate_taken: { retryHint: 'never', status: 'CONFLICT' },
  // fleet.setMyVehicleFeatures: a feature his kind of vehicle cannot offer (AC on a tuktuk), `CLASS_FEATURES`
  vehicle_feature_not_offered: { retryHint: 'never', status: 'BAD_REQUEST' },
  driver_not_in_fleet: { retryHint: 'never', status: 'FORBIDDEN' },
  handover_code_invalid: { retryHint: 'now', status: 'BAD_REQUEST' },
  handover_code_locked: { retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  cash_receipt_exceeds_held: { retryHint: 'never', status: 'CONFLICT' },
  task_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  menu_item_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  import_job_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  import_state_conflict: { retryHint: 'never', status: 'CONFLICT' },
  deal_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  deal_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  deal_state_conflict: { retryHint: 'never', status: 'CONFLICT' },
  dispute_response_closed: { retryHint: 'never', status: 'CONFLICT' },
  dispute_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  staff_last_owner: { retryHint: 'never', status: 'CONFLICT' },
  staff_invite_not_pending: { retryHint: 'never', status: 'CONFLICT' },
  store_hours_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },

  // launch control room (kill switches, throttle, banner, approvals, support desk)
  service_paused: { retryHint: 'later', status: 'CONFLICT' },
  zone_at_capacity: { retryHint: 'later', status: 'CONFLICT' },
  control_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  zone_unknown: { retryHint: 'never', status: 'NOT_FOUND' },
  zone_key_taken: { retryHint: 'never', status: 'CONFLICT' },
  zone_shape_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  zone_overlap: { retryHint: 'never', status: 'CONFLICT' },
  zone_check_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  zone_check_expired: { retryHint: 'never', status: 'CONFLICT' },
  banner_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  banner_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  quiet_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  quiet_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  season_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  season_overlap: { retryHint: 'never', status: 'CONFLICT' },
  slot_full: { retryHint: 'never', status: 'CONFLICT' },
  approval_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  approval_own_item: { retryHint: 'never', status: 'FORBIDDEN' },
  approval_state_conflict: { retryHint: 'never', status: 'CONFLICT' },
  ticket_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  ticket_closed: { retryHint: 'never', status: 'CONFLICT' },
  refund_over_agent_limit: { retryHint: 'support', status: 'FORBIDDEN' },
  refund_needs_escalation: { retryHint: 'support', status: 'FORBIDDEN' },
  refund_customer_cap: { retryHint: 'support', status: 'CONFLICT' },
  refund_exceeds_order: { retryHint: 'never', status: 'BAD_REQUEST' },
  refund_no_customer: { retryHint: 'never', status: 'BAD_REQUEST' },
  // Console › حجز بالتلفون (taxi/tuktuk step 4): a landmark gone from the list; an order that was not booked by phone
  phone_booking_place_unknown: { retryHint: 'never', status: 'NOT_FOUND' },
  phone_booking_not_found: { retryHint: 'never', status: 'NOT_FOUND' },

  // identity
  phone_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  otp_invalid: { retryHint: 'now', status: 'BAD_REQUEST' },
  otp_expired: { retryHint: 'never', status: 'BAD_REQUEST' },
  otp_locked: { i18n: 'error.too_many_attempts', retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  otp_resend_too_soon: { retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  rate_limited: { retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  otp_not_found: { retryHint: 'never', status: 'BAD_REQUEST' },
  session_expired: { retryHint: 'never', status: 'UNAUTHORIZED' },
  token_invalid: { retryHint: 'never', status: 'UNAUTHORIZED' },
  refresh_reused: { retryHint: 'never', status: 'UNAUTHORIZED' },
  reverification_required: { retryHint: 'reverify', status: 'FORBIDDEN' },
  role_frozen: { retryHint: 'reverify', status: 'FORBIDDEN' },
  shared_phone_role_forbidden: { retryHint: 'never', status: 'FORBIDDEN' },
  person_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  account_suspended: { retryHint: 'support', status: 'FORBIDDEN' },
  guardian_link_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  guardian_link_not_pending: { retryHint: 'never', status: 'CONFLICT' },
  guardian_self_link: { retryHint: 'never', status: 'BAD_REQUEST' },
  phone_change_same_number: { retryHint: 'never', status: 'BAD_REQUEST' },
  phone_change_taken: { retryHint: 'support', status: 'CONFLICT' },
  phone_change_not_started: { retryHint: 'never', status: 'BAD_REQUEST' },
  lost_sim_manual: { retryHint: 'support', status: 'CONFLICT' },
  sms_not_configured: { retryHint: 'support', status: 'INTERNAL_SERVER_ERROR' },
  sms_send_failed: { retryHint: 'later', status: 'INTERNAL_SERVER_ERROR' },
  otp_channel_unavailable: { retryHint: 'never', status: 'BAD_REQUEST' },

  // orgs / households
  org_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  not_household_member: { retryHint: 'never', status: 'FORBIDDEN' },
  no_payer: { retryHint: 'never', status: 'CONFLICT' },
  household_payer_only: { retryHint: 'never', status: 'FORBIDDEN' },
  household_exists: { retryHint: 'never', status: 'CONFLICT' },
  // joy w4: only payers and orderers spend the household wallet, on kitchen and shop orders
  household_cannot_order: { retryHint: 'never', status: 'FORBIDDEN' },
  household_wallet_food_only: { retryHint: 'never', status: 'BAD_REQUEST' },

  // places / uploads (domain §7)
  location_weak: { retryHint: 'now', status: 'BAD_REQUEST' },
  place_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  place_entrance_too_far: { retryHint: 'never', status: 'BAD_REQUEST' },
  /** The chosen landmark is unknown or farther than `PLACE_LANDMARK_MAX_M` from the pin (maps a2). */
  place_landmark_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  outside_zone: { retryHint: 'never', status: 'BAD_REQUEST' },
  upload_invalid: { i18n: 'error.upload_failed', retryHint: 'now', status: 'BAD_REQUEST' },

  // orders
  order_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  order_state_conflict: { retryHint: 'never', status: 'CONFLICT' },
  order_type_not_supported: { retryHint: 'never', status: 'BAD_REQUEST' },
  order_empty: { retryHint: 'never', status: 'BAD_REQUEST' },
  merchant_required: { retryHint: 'never', status: 'BAD_REQUEST' },
  one_merchant_per_order: { retryHint: 'never', status: 'BAD_REQUEST' },
  catalog_item_unavailable: { retryHint: 'never', status: 'CONFLICT' },
  // joy J7a: «قدر اليوم» names a dish that is off sale; following more dishes than allowed
  pot_dish_unavailable: { retryHint: 'never', status: 'CONFLICT' },
  dish_follow_limit: { retryHint: 'never', status: 'CONFLICT' },
  modifier_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  price_changed: { retryHint: 'never', status: 'CONFLICT' },
  // J-D7: the ride is not (or no longer) one that may switch vehicle
  ride_switch_unavailable: { retryHint: 'never', status: 'CONFLICT' },
  quote_location_required: { retryHint: 'never', status: 'BAD_REQUEST' },
  promotion_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  // merchant deals at checkout: the deal the cart was shown ended, ran out of budget or changed
  deal_changed: { retryHint: 'never', status: 'CONFLICT' },
  // wallet top-up (cash to an ops agent or the next courier)
  topup_amount_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  topup_daily_limit: { retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  topup_code_invalid: { retryHint: 'never', status: 'NOT_FOUND' },
  topup_expired: { retryHint: 'never', status: 'CONFLICT' },
  topup_code_used: { retryHint: 'never', status: 'CONFLICT' },
  topup_amount_mismatch: { retryHint: 'never', status: 'BAD_REQUEST' },
  topup_courier_not_assigned: { retryHint: 'never', status: 'FORBIDDEN' },
  tip_above_cap: { retryHint: 'never', status: 'BAD_REQUEST' },
  // The tip after a good rating (Ali, 2026-10-06): one per order, from the wallet, rated 4–5, within the window.
  tip_not_offered: { retryHint: 'never', status: 'CONFLICT' },
  tip_already_given: { retryHint: 'never', status: 'CONFLICT' },
  tip_window_closed: { retryHint: 'never', status: 'CONFLICT' },
  tip_amount_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  // The two-tap rating is taken within RATING_RULES.windowHours of the order reaching the customer.
  rating_window_closed: { retryHint: 'never', status: 'CONFLICT' },
  // Compliments after a good rating (joy l4): rated 4–5, delivered, within a day; words from the order's own set.
  compliment_not_offered: { retryHint: 'never', status: 'CONFLICT' },
  compliment_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  // «عزيمة» (joy g1): a gift goes to someone else; hidden prices only when the sender pays from his wallet.
  gift_needs_recipient: { retryHint: 'never', status: 'BAD_REQUEST' },
  gift_hidden_prices_need_wallet: { retryHint: 'never', status: 'BAD_REQUEST' },
  // Invite as a gift (joy g2): one invitation per new customer, never your own code.
  invite_invalid: { retryHint: 'never', status: 'NOT_FOUND' },
  invite_own: { retryHint: 'never', status: 'BAD_REQUEST' },
  invite_not_new: { retryHint: 'never', status: 'CONFLICT' },
  invite_already_claimed: { retryHint: 'never', status: 'CONFLICT' },
  // Joy J7d: rides booked for later (20 min – 7 days), favourites (rated 4–5, scheduled only), regular trips.
  ride_schedule_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  favourite_needs_schedule: { retryHint: 'never', status: 'BAD_REQUEST' },
  // Ride ideas c9/s3: a ride for someone else — not the booker's own number, and a person he really has.
  ride_rider_is_you: { retryHint: 'never', status: 'BAD_REQUEST' },
  ride_rider_unknown: { retryHint: 'never', status: 'NOT_FOUND' },
  favourite_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  favourite_needs_good_rating: { retryHint: 'never', status: 'CONFLICT' },
  favourite_limit: { retryHint: 'never', status: 'CONFLICT' },
  regular_trip_limit: { retryHint: 'never', status: 'CONFLICT' },
  occurrence_closed: { retryHint: 'never', status: 'CONFLICT' },
  dinner_not_available: { retryHint: 'never', status: 'CONFLICT' },
  // Ride step 3: the offered drivers and «نبّهه» only while the ride searches; one nudge per driver; avoid list.
  ride_not_searching: { retryHint: 'never', status: 'CONFLICT' },
  nudge_offer_closed: { retryHint: 'never', status: 'CONFLICT' },
  nudge_already: { retryHint: 'never', status: 'TOO_MANY_REQUESTS' },
  // partner.answerClimateCheck: no AC / heating question this shift (mild weather, no confirmed feature, not a ride car)
  climate_check_none: { retryHint: 'never', status: 'CONFLICT' },
  avoid_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  merchant_paused: { retryHint: 'later', status: 'CONFLICT' },
  // backend review 2026-10-04 (apps review #10, #11): opening hours and the restaurant minimum, server-side
  merchant_closed: { i18n: 'error.merchant_closed_now', retryHint: 'later', status: 'CONFLICT' },
  order_below_minimum: { retryHint: 'never', status: 'BAD_REQUEST' },
  participant_unknown: { retryHint: 'never', status: 'BAD_REQUEST' },
  order_cancel_after_pickup: { retryHint: 'never', status: 'CONFLICT' },
  partial_accept_not_pending: { retryHint: 'never', status: 'CONFLICT' },
  partial_accept_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  prep_already_extended: { retryHint: 'support', status: 'CONFLICT' },
  dispute_window_closed: { retryHint: 'support', status: 'CONFLICT' },

  // chat, masked calls, share-trip (notifications & support §2, scoring & safety §5)
  chat_not_party: { retryHint: 'never', status: 'FORBIDDEN' },
  chat_not_open: { retryHint: 'later', status: 'CONFLICT' },
  chat_closed: { retryHint: 'never', status: 'CONFLICT' },
  // s7 «نسيت غرض»: only a completed ride, only within 24 h of its end
  chat_lost_item_unavailable: { retryHint: 'never', status: 'CONFLICT' },
  chat_quick_reply_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  /** Voice notes are for the customer ↔ courier / driver chat and the support chat only (`VOICE_THREAD_KINDS`). */
  chat_voice_unavailable: { retryHint: 'never', status: 'BAD_REQUEST' },
  // «كلّم الدعم»: a customer opens at most CHAT_SUPPORT_OPENS_PER_DAY new support chats a day.
  chat_support_limit: { retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  call_unavailable: { retryHint: 'later', status: 'CONFLICT' },
  share_link_invalid: { retryHint: 'never', status: 'NOT_FOUND' },
  /** "Send drivers here" for this zone went out less than 10 minutes ago. */
  nudge_too_soon: { retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  /** The delivery photo is not an upload of this courier (or never arrived). */
  handover_photo_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  share_not_shareable: { retryHint: 'never', status: 'BAD_REQUEST' },
  share_trip_over: { retryHint: 'never', status: 'CONFLICT' },

  // SOS (scoring & safety §3)
  sos_not_party: { i18n: 'error.sos_not_party', retryHint: 'never', status: 'FORBIDDEN' },
  sos_trip_over: { i18n: 'error.sos_trip_over', retryHint: 'never', status: 'CONFLICT' },
  sos_rate_limited: { i18n: 'error.sos_rate_limited', retryHint: 'later', status: 'TOO_MANY_REQUESTS' },
  sos_not_found: { i18n: 'error.sos_not_found', retryHint: 'never', status: 'NOT_FOUND' },
  sos_cancel_window_passed: { i18n: 'error.sos_cancel_window_passed', retryHint: 'never', status: 'CONFLICT' },
  safety_incident_closed: { i18n: 'error.safety_incident_closed', retryHint: 'never', status: 'CONFLICT' },
  safety_no_contact: { i18n: 'error.safety_no_contact', retryHint: 'never', status: 'NOT_FOUND' },

  // trips
  trip_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  stop_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  trip_state_conflict: { retryHint: 'never', status: 'CONFLICT' },
  stop_state_conflict: { retryHint: 'never', status: 'CONFLICT' },
  not_trip_courier: { retryHint: 'never', status: 'FORBIDDEN' },
  vehicle_too_small: { retryHint: 'never', status: 'CONFLICT' },
  child_handover_required: { retryHint: 'never', status: 'BAD_REQUEST' },
  unreachable_not_started: { retryHint: 'never', status: 'CONFLICT' },
  unreachable_too_early: { retryHint: 'later', status: 'CONFLICT' },
  unreachable_not_active: { retryHint: 'never', status: 'CONFLICT' },
  // dispatch
  dispatch_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  offer_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  offer_not_yours: { retryHint: 'never', status: 'FORBIDDEN' },
  offer_expired: { retryHint: 'never', status: 'CONFLICT' },
  offer_taken: { retryHint: 'never', status: 'CONFLICT' },
  offer_conflicts_current_job: { retryHint: 'never', status: 'CONFLICT' },
  over_cap: { retryHint: 'support', status: 'FORBIDDEN' },
  override_invalid: { retryHint: 'never', status: 'CONFLICT' },
  override_reason_required: { retryHint: 'never', status: 'BAD_REQUEST' },
  // ledger (M2 Step 6)
  payout_exceeds_balance: { retryHint: 'never', status: 'CONFLICT' },
  settlement_nothing_due: { retryHint: 'never', status: 'CONFLICT' },
  adjustment_incident_required: { retryHint: 'never', status: 'BAD_REQUEST' },
  adjustment_second_approver: { retryHint: 'never', status: 'FORBIDDEN' },
  handover_mismatch: { retryHint: 'support', status: 'CONFLICT' },
  new_customer_cash_cap: { retryHint: 'never', status: 'BAD_REQUEST' },
  // "الخردة علينا" (Phase 3, 2026-10-05): a stated note out of range; change-to-wallet refused at the door
  tender_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  change_to_wallet_not_cash: { retryHint: 'never', status: 'BAD_REQUEST' },
  change_to_wallet_mismatch: { retryHint: 'never', status: 'BAD_REQUEST' },
  change_to_wallet_above_cap: { retryHint: 'never', status: 'BAD_REQUEST' },
  // routes — الرجعة (intercity)
  garage_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  corridor_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  announce_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  departure_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  departure_state_conflict: { retryHint: 'never', status: 'CONFLICT' },
  not_departure_driver: { retryHint: 'never', status: 'FORBIDDEN' },
  seat_unavailable: { i18n: 'intercity.seat_taken_toast', retryHint: 'never', status: 'CONFLICT' },
  seat_adjacency_blocked: { retryHint: 'never', status: 'CONFLICT' },
  family_only_departure: { retryHint: 'never', status: 'CONFLICT' },
  booking_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  booking_state_conflict: { retryHint: 'never', status: 'CONFLICT' },
  hold_expired: { i18n: 'intercity.hold_expired', retryHint: 'never', status: 'CONFLICT' },
  wallet_insufficient: { retryHint: 'never', status: 'CONFLICT' },
  cash_reservation_revoked: { retryHint: 'never', status: 'FORBIDDEN' },
  seat_cancel_too_late: { retryHint: 'never', status: 'CONFLICT' },
  pin_invalid: { retryHint: 'now', status: 'BAD_REQUEST' },
  walkup_seat_taken: { retryHint: 'never', status: 'CONFLICT' },
  no_show_not_allowed: { retryHint: 'later', status: 'CONFLICT' },
  depart_blocked: { retryHint: 'never', status: 'CONFLICT' },
  pickup_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  door_pickup_limit: { retryHint: 'never', status: 'CONFLICT' },
  demand_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  demand_state_conflict: { retryHint: 'never', status: 'CONFLICT' },
  request_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  request_state_conflict: { retryHint: 'never', status: 'CONFLICT' },
  offer_price_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  // Menu photo service (maps k3).
  menu_photo_request_open: { retryHint: 'never', status: 'CONFLICT' },
  menu_photo_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
  menu_photo_state_conflict: { retryHint: 'never', status: 'CONFLICT' },
  menu_photo_taken: { retryHint: 'never', status: 'CONFLICT' },
  menu_photo_no_shots: { retryHint: 'never', status: 'CONFLICT' },
  menu_photo_item_not_listed: { retryHint: 'never', status: 'BAD_REQUEST' },
  menu_photo_schedule_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
} as const satisfies Record<string, ErrorDef>;

export type ErrorCode = keyof typeof ERROR_TABLE;
export const ErrorCode = z.enum(Object.keys(ERROR_TABLE) as [ErrorCode, ...ErrorCode[]]);

/** The locale key holding a code's message, or null when it has none yet (the table test fails then). */
export function errorMessageKey(code: ErrorCode): MessageKey | null {
  const def: ErrorDef = ERROR_TABLE[code];
  const key = def.i18n ?? `error.${code}`;
  return hasKey(key) ? key : null;
}

/** Builds the wire envelope for a code; the words come from packages/i18n. */
export function errorEnvelope(
  code: ErrorCode,
  extra?: { retryAfterSec?: number; params?: Record<string, string | number>; messageAr?: string | undefined },
): ErrorEnvelope {
  const def: ErrorDef = ERROR_TABLE[code];
  const params = { minutes: 3, ...extra?.params };
  const key = errorMessageKey(code);
  // A message set by an operator (a kill switch's customer notice) replaces the table's Arabic text.
  const message_ar = extra?.messageAr ? extra.messageAr : key ? t(key, params, 'ar-IQ') : (def.message_ar ?? code);
  const message_en = key ? t(key, params, 'en') : (def.message_en ?? code);
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
    extra?: { retryAfterSec?: number; params?: Record<string, string | number>; cause?: unknown; messageAr?: string | undefined },
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
