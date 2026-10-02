# Driver (درايفر) — Customer App Spec

Date: 2026-10-03 · Status: approved — Plan 7 complete (screens on paper; mockups next).

## 1. Home
Food-led contextual feed: pinned active order/ride pill; "now" cards (khat countdown, departure board, reorder); الرجعة/السفر card second ("بغداد ← العزيزية: سيارتين هسة، أقربها 17:30"); food rails (favourites, open now, deals, categories); compact "all services" row near the top (arrangement decided in mockups). New users get a curated default. One search bar over everything (dishes, restaurants, "تكسي للكوت", "بغداد", a person's name), recent and voice input. Taxi/intercity live in a map-first tab.

## 2. الرجعة (the way back) — intercity system
Garages are objects: Aziziyah (البوابة ١، البوابة ٢، السوق), Baghdad (النهضة). Live board per garage: departures with driver photo + plate, "leaves at X or when full", seat map (front seat amber, taken greyed, walk-ups marked), price, front seat +2,000, pickup options (garage / on the way at a marked meeting point with photo +1,000–2,000 / from my door +fee by distance, driver accepts). Hold a seat 10 min free; prepay to own it; PIN check-in; late meter and grace rules apply at garage and meeting points.
Demand board: "أريد أرجع" post with time window chips, seats, pickup preference; drivers see demand counts per garage and window and announce against them; car confirmed when enough seats claimed; unserved demand escalates to dispatcher. Reverse direction identical from the three Aziziyah garages; Kut second corridor. Request board for other destinations and private cars: post, driver offers, pick, wallet deposit, in-app chat. Vetted drivers may post open seats on their own trips. Intercity safety: share-trip by default, per-departure check-in selfie, live car position to all booked riders. Boarding pass at T−30 (PIN, seat, live car, wait-for-me, share). Optional door drop-off at arrival (+fee).

## 3. Food ordering
Restaurant card shows delivery fee and minimum before opening. Restaurant page: hero, real ETA from prep + distance, rating with count, sticky categories, dish cards with one-tap add. Item bottom sheet: variants, modifier chips, qty, note, "لمن؟" avatar chips (me / saved people / new). Cart grouped by person; same-kitchen upsells; live total includes delivery and fees. Checkout, one screen: deliver-to (saved place with photo or street point −250, map snippet), recipient, when (now/schedule), payment (cash default, wallet, points toggle), named price lines, promo field, button "اطلب هسة · total". Post-tap: "finding your kitchen" until merchant accepts (≤ 90 s); rejection suggests two similar open restaurants with the cart carried over. Group ordering via shared cart link (phase 2 UI).

## 4. Live order / ride screen
Map 60% + draggable sheet. Collapsed: status + ETA. Expanded: timeline with real timestamps (current step pulses, honest delay text with auto-credit), courier/driver card (photo, name, vehicle + plate, rating, "verified today ✓", message with quick replies, masked call, share trip), order details, context actions (tip after delivery, switch to street pickup before pickup, report problem, cancel with fee preview; seats: PIN, wait-for-me, late meter). Map: gliding rotating marker, shortening route, home pin with gate photo, follow camera with re-centre chip. Arrival: haptic + full-screen "وصل!" with gate photo, two-tap rating (delivery and food separately), points animating into wallet. Persistent notification / live activity. Degraded states: signal lost, running late, reassigning.

## 5. City taxi / tuktuk
Map-first: "وين تروح؟" with saved-place chips, vehicle choice (tuktuk / car / عائلة) with locked prices, pickup mode toggle (door / nearest street point with photo), "for someone else", schedule chip. Matching shows waves honestly, then the live screen.

## 6. Parcels
Flow: what (photo, size chips, declared value, fragile) → from → to (participant/new contact with place) → speed (city now / next Baghdad car) → price → confirm. Recipient PIN; sender release approval prompt; photos in history.

## 7. Errands / shop-for-me
Chat-like composer (text or voice list), shop or السوق, ceiling, payment; substitution prompts as one-tap cards; receipt photo and real total before payment.

## 8. Khat
Route card per subscription: driver, car, stops with times, attendance calendar, next payment; actions: pause, absence for tomorrow, change stop, chat. Guardian live view: child icon on route, arrival pushes, substitute intro card. Seat marketplace to find free seats by home, destination, time.

## 9. Wallet, points, household
Balance; points with IQD worth and pending-to-claim; readable transactions; top-up via agent shops map, driver, ZainCash when live. Household: members, limits, approval requests, shared places.

## 10. Profile
Saved places with photos, saved people, payment preferences, language, notifications, safety (emergency contact, share-by-default), help (self-serve then chat), tier badge.

## 11. Mockup set (next)
Home, restaurant page, checkout, live tracking, garage board. Placeholder palette until the brand is chosen.
