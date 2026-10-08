# Data inventory: what happens to a person's data when the account is deleted

Plan W7 (REL-01, the store rule that an app with sign-up lets people delete their account in the app).
How deletion works is in `docs/api/account-deletion.md`. This file lists **every table** in the
`public` and `identity_vault` schemas and what happens to a deleted customer's rows in it.

`apps/api/src/account-deletion.e2e.test.ts` reads this table and fails when:
- a table in `packages/db/prisma/schema.prisma` is missing here (a new table must be classified
  before it merges), or a row here names a table that no longer exists;
- the **erase** and **blur** tables are not exactly the tables the registered erasure steps name
  (plus identity's own, `IDENTITY_ERASED_TABLES`), or one table is named by two steps.

Classes:
- **erase**: his rows are deleted.
- **blur**: his rows stay (another person's record, money or a driver's history needs them) but the
  personal parts go: free text he wrote, names and numbers, and pins snapped to a 0.01° grid
  (about 1.1 km in Aziziyah, `ERASURE_GRID_DEG`).
- **keep**: rows stay as they are. They hold ids, amounts and fixed reasons only, never a name, a
  number or his words; the reason says why they must stay.
- **none**: holds nothing about customers.

A deleted person's id stays in the kept rows; the `people` row it points to keeps no name, number or
contact (those are erased from `identity_vault`), so the id no longer leads to a person.

Only plain customer accounts delete themselves in the app. Anyone who works or worked with us
(driver, courier, restaurant, staff) has a work role and is closed by support (`work_role` blocker),
so the drivers' and merchants' tables below are **keep** for this flow.

<!-- inventory:start -->
| Table | Class | Owner | What happens and why |
|---|---|---|---|
| `identity_vault.person_identities` | erase | identity | Name, number, photo, trusted contacts: deleted when the account closes. |
| `identity_vault.child_identities` | erase | identity | His children's names and photos (خطوط): deleted when the account closes. |
| `identity_vault.participant_identities` | erase | identity | Names others gave him and names he gave others («ماما»): deleted. |
| `identity_vault.retired_phones` | keep | identity | Written at deletion: a peppered hash of the number and the account's start date only, so a new account on the number gets no second first-order reward. |
| `identity_vault.vault_access_logs` | keep | identity | Who read the vault and why (the law's access audit); ids only. |
| `public.people` | keep | identity | The row stays as a tombstone (`deleted_at`, `erased_at`): kept money and safety records point to it. No name or number in it. |
| `public.roles` | keep | identity | Revoked at deletion; what someone was allowed to do stays for the audit. |
| `public.devices` | erase | identity | His phones: deleted. |
| `public.sessions` | erase | identity | Signed out everywhere: deleted. |
| `public.otp_challenges` | erase | identity | Sign-in codes for his number: deleted. |
| `public.guardian_links` | erase | identity | Guardian ⇄ child links: deleted. |
| `public.push_tokens` | erase | notify | Deleted. |
| `public.notify_preferences` | erase | notify | Deleted. |
| `public.notify_deliveries` | erase | notify | The messages sent to him (their wording names places and people): deleted. |
| `public.launch_interests` | erase | notify | «خبرني لما يوصل» sign-ups: deleted. |
| `public.favourite_drivers` | erase | ride-habits | Deleted. |
| `public.avoided_drivers` | erase | ride-habits | Deleted. |
| `public.regular_trips` | erase | ride-habits | His saved regular rides (home, work): deleted. |
| `public.regular_trip_occurrences` | erase | ride-habits | Go with their regular trip. |
| `public.ride_footprints` | erase | ride-habits | Where he usually rides from and to: deleted. |
| `public.dish_follows` | erase | catalog | Deleted. |
| `public.invite_codes` | erase | referrals | His invite code: deleted (a link someone still has stops working). |
| `public.referrals` | keep | referrals | Who invited whom and the reward checks (money and abuse rules); ids only. |
| `public.share_links` | erase | tracking | Live-trip links he made: deleted, so they stop working. |
| `public.places` | erase | places | His saved places and his landmark proposals not yet approved: deleted. An approved landmark is public now: it stays, without his id. |
| `public.place_photos` | erase | places | Photos of his proposals: deleted with them. |
| `public.uploads` | erase | places | Every file he uploaded, except photos on approved public landmarks: deleted from storage and the table. |
| `public.landmark_photos` | erase | ops | His photos waiting for review: deleted. Approved ones are public and stay. |
| `public.chat_messages` | blur | chat | The other side of the chat (courier, support) keeps the thread; his text, photos, voice notes and pins are cleared. |
| `public.chat_reads` | keep | chat | Read marks; ids and times only. |
| `public.chat_threads` | keep | chat | One per order; ids only. |
| `public.orders` | blur | orders | The order stays (restaurant pay, courier pay, the ledger's receipts). His notes are cleared and the drop-off pin is blurred; the zone stays. Waits until no order of his is open. |
| `public.order_lines` | blur | orders | His notes on dishes cleared; what was bought and its price stay. |
| `public.participants` | blur | orders | Labels, notes and number hashes on his orders and on his own participant rows: cleared. |
| `public.stops` | blur | orders | Delivery and arrival pins on his orders: blurred. |
| `public.courier_ratings` | keep | orders | Stars and fixed reasons: the courier's score history. |
| `public.order_compliments` | keep | orders | Fixed compliment keys: the courier's record. |
| `public.parcels` | keep | orders | Parcels are not live; their erasure is added with the parcels launch. |
| `public.seat_bookings` | blur | routes | الرجعة bookings stay (the driver's pay); his pickup pin is blurred, his note and review text cleared. Waits until no booking is live. |
| `public.demand_posts` | blur | routes | Door-pickup pins blurred. Waits while a post is open. |
| `public.ride_requests` | blur | routes | Pickup and drop-off pins blurred, his note cleared. Waits while a request is open. |
| `public.seats` | keep | routes | Seat history on a departure (the driver's pay); ids only. |
| `public.phone_bookings` | blur | phone-booking | Rides support booked for his number: the place names are cleared. |
| `public.events` | blur | events | The event log stays (it is how money and disputes are traced); locations and free text in his events are removed. |
| `public.outbox` | blur | events | Same as events, for messages still in the outbox. |
| `public.support_tickets` | keep | support | Ticket headers: ids, categories, states. |
| `public.support_ticket_entries` | blur | support | What he wrote to support is cleared; what support wrote stays. |
| `public.org_members` | erase | orgs | He leaves every household. A payer whose household still has people in it hands it over first (`household` blocker). |
| `public.orgs` | blur | orgs | A household left empty loses its name («بيت علي»). |
| `public.payer_approvals` | keep | orgs | Household spending approvals: ids and amounts (money audit). |
| `public.khat_absences` | blur | khat | Notes he wrote on absences cleared; the run's record stays. Children's names were in the vault and are gone. |
| `public.subscriptions` | keep | khat | خطوط billing history; ids and amounts. A running subscription blocks deletion. |
| `public.khat_sweep_alerts` | keep | khat | The driver's run safety record. |
| `public.ledger_events` | keep | ledger | The money ledger is append-only and kept by law. Deletion needs an empty wallet (M-6 decides what happens to money in it); points are given up. |
| `public.wallet_topups` | keep | topups | Cash top-ups: money record. |
| `public.promo_redemptions` | keep | promotions | One-per-person offer checks (money); ids only. |
| `public.promotions` | none | promotions | Restaurant offers. |
| `public.safety_incidents` | keep | safety | SOS records are kept for safety and legal holds (lawyer item L1), with their last position. |
| `public.safety_incident_entries` | keep | safety | The SOS desk's notes. |
| `public.safety_incident_fixes` | keep | safety | SOS positions, as above. |
| `public.trips` | keep | trips | Driver and courier trips; ids only (his pins are on stops). |
| `public.trip_orders` | none | trips | Trip ⇄ order links. |
| `public.trail_points` | keep | tracking | The driver's own GPS trail (partitioned by month, short retention). |
| `public.dispatch_offers` | keep | dispatch | Drivers' offers. |
| `public.ride_request_offers` | keep | routes | Drivers' offers on ride requests. |
| `public.departures` | keep | routes | Drivers' departures. |
| `public.routes` | keep | khat | خطوط routes (the driver's). |
| `public.garage_taxis` | keep | garage-taxi | Drivers' garage taxis. |
| `public.intercity_pin_attempts` | keep | routes | Drivers' boarding-code attempts. |
| `public.driver_check_ins` | keep | driver-account | Drivers' records. |
| `public.driver_documents` | keep | driver-account | Drivers' records. |
| `public.driver_shift_checks` | keep | driver-account | Drivers' records. |
| `public.fleet_drivers` | keep | fleet | Fleet records. |
| `public.vehicles` | keep | fleet | Vehicles. |
| `public.zone_checks` | keep | zones | Drivers' zone checks. |
| `public.ops_cash_receipts` | keep | ops | Courier cash hand-ins (money). |
| `public.ops_tasks` | none | ops | Field tasks. |
| `public.ops_kill_switches` | none | ops | Switches. |
| `public.ops_zone_capacities` | none | ops | Capacities. |
| `public.daily_pots` | none | ops | Staff records. |
| `public.incidents` | keep | ops | Ops incidents; staff ids only. |
| `public.console_audit_log` | keep | controls | Staff actions audit; ids only. |
| `public.quiet_periods` | none | controls | Staff settings. |
| `public.system_banners` | none | controls | Staff settings. |
| `public.merchant_onboardings` | keep | merchant-admin | Restaurant sign-up records. |
| `public.merchant_dispute_responses` | keep | merchant | The restaurant's answers. |
| `public.merchant_settlements` | none | ledger | Restaurant pay. |
| `public.menu_import_jobs` | none | menu-photos | Restaurant menus. |
| `public.menu_photo_requests` | none | menu-photos | Restaurant menus. |
| `public.menu_photo_shots` | none | menu-photos | Restaurant menus. |
| `public.catalogs` | none | catalog | Menus. |
| `public.catalog_items` | none | catalog | Menus. |
| `public.catalog_price_changes` | none | catalog | Staff price changes. |
| `public.modifier_groups` | none | catalog | Menus. |
| `public.modifiers` | none | catalog | Menus. |
| `public.taxonomy_nodes` | none | catalog | Food categories. |
| `public.search_unmet` | none | catalog | Searched words with no result; no person. |
| `public.meeting_points` | none | places | Public meeting points. |
| `public.cities` | none | config | Cities. |
| `public.zones` | none | zones | Zones. |
| `public.quotes` | none | pricing | Kept prices; no person. |
| `public.quote_components` | none | pricing | Price parts. |
| `public.eta_samples` | none | eta | Learned travel times; no person. |
| `public.eta_corrections` | none | eta | Learned factors. |
| `public.subscriber_deliveries` | none | events | Outbox fan-out bookkeeping. |
| `public.scheduled_timers` | none | shared | Job timers; order and trip ids only. |
<!-- inventory:end -->

## Open items
- **Money in the wallet (M-6):** only an empty wallet deletes now. Ali decides whether money left is
  paid out, given to charity or held; points are given up (shown on the screen first).
- **Free text on receipts (L1):** `order_lines.free_text` (a «طلب خاص» line) stays on the restaurant's
  receipt. The lawyer confirms retention for receipts and SOS records.
- **Tables on branches not yet merged** (`recipient_contacts`, `household_invites`, `customer_access`)
  are classified in their own PRs when they land; this test fails until they are.
