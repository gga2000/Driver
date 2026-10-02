# Driver (درايفر) — Partner & Merchant Apps Spec

Date: 2026-10-03 · Status: approved — Plan 8 complete.

## Driver Partner (couriers, taxi/tuktuk, intercity and khat drivers, fleet owners, field ops)

### Core states
- Online waiting: map with own position, online/offline switch, today's earnings pill ("12,500 · 6 طلبات"), demand hint. Intercity drivers: garage board + demand count per window. Khat drivers: today's run card with stop list.
- Offer: full-screen card; pickup and dropoff zone names; pay with every named component; distance to pickup; merchant prep status; 15/20-second ring; large accept/decline; haptic + loud sound; batch offers say "طلب ثاني على طريقك +700".
- On a job: one task at a time with a single advancing action button; gate photo at dropoff; quick contact; in-app navigation; unreachable-customer protocol; cash collection confirm writes the ledger.

### Also
Earnings and ledger with cap bar; scorecard with nudges (visible from day 31); documents and expiry; daily selfie check-in with liveness; intercity: announce departure (garage, time), demand counts, walk-up marking per seat, door/on-the-way pickups, ordered pickup route, PIN check-in; khat: absence report, substitute acceptance; fleet owner dashboard (vehicles, drivers, earnings); Ops mode for field staff (landmark photos, cash receipts, merchant onboarding).

## Driver Merchant (restaurants, grocers; phone + tablet layouts)
- Orders board: columns جديد / يتحضّر / جاهز; cards with order number, items grouped by person with notes in bold, courier state, 90-second accept ring; accept with prep-time choice (10/15/25/custom); reject with reason; "جاهز" hands off to courier; Bluetooth printer prints accepted orders.
- Busy mode: +10 min on all prep times, auto-expires after an hour.
- Menu: categories, availability toggles, sold-out-today auto-reset, price edit with history, photo replace, modifiers, photo-based menu import corrected by staff.
- Deals: self-serve promotions with projected cost, platform approval switch.
- Money: today's sales, commission by tier, weekly payout statement per order, courier-waiting charges, disputes with evidence and default outcome.
- Insights: prep-time honesty, rejection rate, item ratings with review text, peak hours.
- Staff: owner invites by phone; roles gate money views.
