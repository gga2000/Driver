# Driver (درايفر) — Edge-Case Decisions (adopted 2026-10-03)

Status: approved. These rules amend the specs they reference and bind Milestone 2. Source: `docs/research/2026-10-03-edge-case-review.md` (163 items); the ten dangerous ones decided below, the rest adopted as recommended unless a line here says otherwise.

## 1. Referral (amends domain §10, money §5)
Referral pays 200 points (2,000 IQD) per side, unlocked after the referee's second completed cash order ≥ 10,000 IQD; monthly cap per referrer (config, default 10); fingerprint on device + phone + home place. Launch budget line recomputed accordingly.

## 2. Points (amends domain §10)
Points earn on platform revenue (service fee + commission), 1 point per 100 IQD of revenue, capped per order (config, default 50); rides and seats 1 per 200 IQD of platform take. 100 points = 1,000 IQD, redeemable against the service fee first, delivery fee second. Finance page shows points liability as a share of margin.

## 3. Merchant cash account (replaces weekly payout in money §4)
Every cash order instantly creates `merchant_payable` net of commission; the Merchant app shows a live balance. Settlement modes per merchant: nightly by the collecting courier (Partner builds a return route; each hand-over confirmed by merchant PIN or tablet tap, `merchant_paid_by_courier`), on-demand ("اطلب فلوسك" routes the courier holding their cash or ops/ZainCash, target within the hour), daily ZainCash, or weekly bulk. Exposure cap per merchant (default 300,000) triggers automatic settlement. Commission netted per line; weekly statement is a summary. Every hand-over has PIN, timestamps, both confirmations and a WhatsApp receipt; discrepancies open incidents; late-settling couriers lose score and cash cap. Courier cash caps count only cash not yet returned to merchants plus fees and commission owed.

## 4. New-customer cash cap (amends domain §9, money §5)
First three cash orders per new account capped at 25,000 IQD with an arriving-call confirmation before the courier leaves the restaurant; "prepay required" keys on device + phone + place; month-1 prank-loss fund.

## 5. Khat hand-over (amends domain §2, scoring §3)
Per-child tap-in/tap-out by name at each stop; "arrived" push to the guardian only on the child's tap-out at school; substitute pool pre-approved by guardians at enrolment and shown with photos; one-tap guardian decline of a substitute.

## 6. Rebroadcast compensation (amends dispatch §3)
+500 pickup compensation paid only to drivers who were not in waves 1–2; drivers who ignored the offer are excluded for that trip; an offer counts as "seen" only after 3 s in the foreground.

## 7. Identity hygiene (amends domain §1)
Re-verify by OTP after 120 idle days or on a new device; guardian, wallet-withdrawal and driver roles frozen until re-verified; number change requires OTP on both numbers; lost-SIM support flow with ID match; shared family phones declare themselves at onboarding and cannot hold guardian or driver roles.

## 8. Garage late meter (amends domain §2)
Meter reference = announced departure time; computed server-side; runs only while the driver is checked in inside a 150 m garage geofence and at least one other rider has checked in; forfeit after 20 min converts into an automatic hold on the next departure within 2 h; if none, dispatcher paged and the private-car board opened at seat price. Driver meter waived for stops inside seeded checkpoint geofences.

## 9. Seat adjacency (amends domain §1–2)
Rider declares travelling-as (رجال / نساء / عائلة); back-middle never sold to a lone rider between two strangers of the other declaration; "book the row" and "book the car"; family-only departures as a route attribute; seat map per vehicle type (saloon 4, SUV 6, van 7/11).

## 10. Evidence integrity (amends domain §6, §11)
Events carry device wall time and monotonic uptime; evidence events (arrival, delivery, cash collected) are bound to server receipt time; device skew beyond ±4 min flags; offline replays received after a trip's `detached_at` are quarantined as `late_replay` for support, never settled.

## Also adopted from the full review (selection binding on M2)
Per-merchant pause windows seeded by city (Friday prayer); merchant heartbeat and courier release; partial-accept flow; exact-change prompt and courier float; menu-photo parity checks; learned prep times; scheduled-order offer timing; Ramadan mode; wallet debt for unpaid fees; order caps per vehicle class; printer-offline marker; early-close reason; edge zones opt-in for tuktuks; night/peak/weather definitions; customer-side ride completion; zone-pair travel-time matrix; evening-before scheduled rides; hard latest departure; checked-in-or-no-show before `departed`; walk-up safeguards; demand-post expiry; launch prepay rails; door-pickup limits; position-sharing window; cancel-fee doubling after 18:00; 20% deposits on the request board; khat calendar proration; parcel refusal with photo; substitution approval before purchase; caps by role; daytime agent collection; settlement references; negative-balance payouts; commission base definition; totals in multiples of 500; guarantee conditions; AI-support refund limits; SMS twins for templates; summer hot-item cap.
