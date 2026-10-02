# Driver (درايفر) — Scoring & Safety Rules Spec

Date: 2026-10-02 · Status: approved — Plan 4 complete. All thresholds config per city.

## 1. Driver reliability index
0–100, recomputed nightly over a rolling 14-day window (older week weighs half).

| Component | Weight | Full marks | Zero |
|---|---|---|---|
| Acceptance rate of offers seen | 20 | ≥ 85% | ≤ 50% |
| Timeout/ignore rate | 10 | ≤ 5% | ≥ 30% |
| On-time arrival vs ETA | 20 | ≥ 90% within +3 min | ≤ 60% |
| Cancellations after accept | 15 | 0 | ≥ 4 per 100 |
| Customer rating (last 50) | 15 | ≥ 4.8 | ≤ 4.0 |
| Disputes lost per 100 trips | 10 | 0 | ≥ 3 |
| Cash discrepancies | 5 | 0 | ≥ 2 |
| Route deviation / idle gaming | 5 | clean | flagged twice |

Tiers: Bronze < 70 · Silver 70–84 · Gold ≥ 85 and ≥ 100 trips. Effects: offer priority, cash cap (75k/150k/300k), bonuses, badge. Days 1–30 observation (admins only; driver told a learning period is running). From day 31: same-evening nudge in Iraqi Arabic when a component drops below its Silver line; consequences apply the following Sunday, never same day. Khat drivers: separate index (stop punctuality ≥ 95% within 5 min, missed days, substitute requests, guardian ratings). Merchants: acceptance time, prep-time honesty, rejection rate, item availability, item ratings. Staff: dispatch response time, resolution time.

## 2. Onboarding and identity
Driver (Partner, ~10 min): OTP → name → reference selfie → photos of national ID (both sides), licence (cars), vehicle with plate, registration if available → vehicle class, known areas, shift preferences → fleet-owner approval when applicable → ops review in Console (ID vs selfie, plate vs photo) → `active` within 24 h, WhatsApp confirmation. First 30 days: observation tier, cash cap 75k, parcels ≤ 50k declared value.
Daily check-in: liveness selfie at first online each day (blink/turn), compared to reference; two failures → offline + ops alert; khat and intercity drivers also check in per run. Document expiry reminders at 30 days; expired → offline.
Customers: OTP only; name + saved place at first order. Household/guardian links need the second person's OTP consent. Minors are participants under a guardian, never account holders.
Merchants: owner ID + shop photo + field-ops visit (menu photography same visit) → `active`.

## 3. SOS, deviation, incidents
SOS on every active trip (both sides): 3-second hold → dispatcher red alert with live location, trip, both profiles, one-tap calls; trip auto-shared with the user's emergency contact; audio recording on the pressing device (consent at signup); dispatcher acknowledges within 60 s or it escalates to Ali by call.
Route deviation: ops alert when a ride or khat trip leaves the planned route > 500 m or stops > 5 min unexplained; customer gets a one-tap "I'm fine / help" prompt; khat guardians likewise.
Incident: opened by SOS, deviation, failed check-in, lost parcel, harassment/assault report, accident; evidence pack auto-attached (trail, timestamps, photos, messages, call log, scores); states `open → investigating → resolved | escalated`; violence, harassment, theft suspend the driver immediately pending review; final decisions by Ali with the pack.

## 4. Family option
Ride class "عائلة": routes only to drivers approved for family rides (vetted, Silver or Gold, no incidents) and female drivers where available; customer may book all seats for privacy. The app states honestly that it is a vetted-driver promise until female drivers exist.

## 5. Visible trust
Plate + photo + share-trip before every ride; "verified today ✓" badge from the daily check-in.
