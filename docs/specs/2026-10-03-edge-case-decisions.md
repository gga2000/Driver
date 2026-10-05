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
Per-merchant pause windows seeded by city (Friday prayer); merchant heartbeat and courier release; partial-accept flow; exact-change prompt and courier float; menu-photo parity checks; learned prep times; scheduled-order offer timing; Ramadan mode; wallet debt for unpaid fees; order caps per vehicle class; printer-offline marker; early-close reason; edge zones opt-in for tuktuks; night/peak/weather definitions; customer-side ride completion; zone-pair travel-time matrix; evening-before scheduled rides; hard latest departure; checked-in-or-no-show before `departed`; walk-up safeguards; demand-post expiry; launch prepay rails; door-pickup limits; position-sharing window; cancel-fee doubling after 18:00; 20% deposits on the request board; khat calendar proration; parcel refusal with photo; substitution approval before purchase; caps by role; daytime agent collection; settlement references; negative-balance payouts; commission base definition; totals in multiples of 500 (superseded 2026-10-04 by the rounding decision below); guarantee conditions; AI-support refund limits; SMS twins for templates; summer hot-item cap.

## UI/UX audit decisions (Ali, 2026-10-04 — docs/research/ui-ux-audit/README.md)
- **Rounding:** customer totals round to 250 IQD; the remainder is credited to the customer's wallet as change ("الباقي رصيد"), never added to the total. Replaces the "round the discount up" presentation and G-88's "totals in multiples of 500". As built: deals apply exactly; a cash customer hands over his price rounded **up** to 250 and the 0–249 remainder is booked as `cash_rounding_credit` into his wallet; wallet payments pay the exact price. The change is the customer's own cash (the courier holds it until he settles, the platform owes it as wallet credit) — no merchant, deal or platform budget funds it, and a merchant never pays more than its deal promises (docs/api/deals-and-topup.md).
- **One-tap accept:** merchants accept with their usual prep time in one tap (busy mode adds 10 min) and may add 5 min once after accepting; the customer's promised time moves and they are told.
- **SOS:** the stub button stays for now as a reminder; the real SOS (3-s hold, dispatcher red alert, live location, emergency contact on every active trip) is a launch requirement. Built 2026-10-05 (`docs/api/safety.md`): the stub is gone.
- **Guest browsing:** home, restaurants and menus are public; sign-in is asked at checkout/booking, with a WhatsApp OTP fallback after 30 s.

## Change to wallet when the courier has no change (2026-10-05 — awaiting Ali's final OK before launch)
Phase 3 "الخردة علينا" (UI/UX audit customer d-1, partner S-2; builds on the 2026-10-04 rounding decision). Built behind no flag; the rule below is what the code enforces — **Ali to confirm the cap and the rule before launch.**
- **The customer's note (a hint, never money):** at checkout a cash customer may say which note he will pay with ("راح أدفع بـ 25,000": the exact amount or the next single note above it). The server keeps it only on a cash order, at least the cash total and at most total + 50,000, in 250s (else `tender_invalid`). The courier's job card says "الزبون يدفع بـ 25,000 · جهّز 7,250 خردة"; the customer's "almost there" and arrival cards say "تدفع بـ 25,000؟ الدليفري يجيبلك 7,250 خردة أو تصير رصيد".
- **Who can trigger it:** only the courier/driver completing the drop-off of a **cash** order, at the door ("ما عندي خردة · حطها رصيد بمحفظته" in the Partner door helper). He records the whole note (`cashCollectedIqd`) and `changeToWalletIqd`; nobody else (customer, merchant, Console) can create this credit. Wallet-paid orders are refused (`change_to_wallet_not_cash`).
- **Server checks (money is server-only):** before the stop is completed, `changeToWalletIqd` must equal collected − cash total (recomputed; `change_to_wallet_mismatch`), be above 0 and a multiple of 250, and at most **25,000** per hand-over (`MoneyRules.changeToWallet.maxIqd`, beside the rounding step; above it he hands the change back in cash: `change_to_wallet_above_cap`). Cash above the total **without** it is refused too, so every credit beyond the 0–249 rounding is named and capped. A retried hand-over is a no-op (the stop is already completed; the ledger group is keyed by the order).
- **Ledger:** the courier's cash account takes the whole note (it counts on his cash cap until he settles); the customer's wallet is credited the extra as its own line `cash_change_to_wallet` (memo `no_change`, "باقي الكاش"), apart from the rounding change `cash_rounding_credit`. Balanced, append-only; no merchant, deal or platform budget funds it — it is the customer's own cash held by the courier. Food, grocery and cash rides (taxi/tuktuk) go through the same path.
- **What people see:** the customer gets an in-app strip "+7,250 دينار رصيد (الباقي)" (a coin flies into the wallet badge) and a push; the receipt and wallet history show "باقي الكاش"; the courier's done screen says "7,250 دينار راحت لمحفظة الزبون" and his cash bar moves to the whole note; the Console order shows "الدليفري ما عنده خردة: استلم 25,000 دينار، و7,250 دينار صارت رصيد للزبون" and the courier's statement line "باقي الكاش رصيد للزبون".
- **Disputes:** the customer opens help on the order ("عندي مشكلة"); support sees the stated note, the recorded note and the `cash_change_to_wallet` line on the order (Console order detail, "وين راحت الفلوس") and on the courier's statement. A wrong credit is corrected with a two-person adjustment against an incident (G-85), never by editing the line. Couriers who use it far more often than their peers are a fraud signal for ops (no automatic rule yet).
- **Simulator:** about one cash drop-off in eight uses it; the cash invariant checks wallet change = rounding change + recorded extra (cash only, ≤ 25,000, in 250s) and the courier's cash on hand = the note he recorded.
