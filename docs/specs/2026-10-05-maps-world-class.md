# World-class maps — program design

Date: 2026-10-05. Status: **approved scope** (Ali, approval board
https://claude.ai/artifact/EyFYQSKo9fQwnQdsxCZ44Y — 67 ideas Yes, 12 left blank and parked, all 8 decisions
taken). This is the program-level design. Each sub-project (§5) gets its own implementation plan before
any code is written.

## 1. Goal

A map people open just to watch, in every app: customers watch the courier glide along real Aziziyah
streets with minutes they can trust; drivers find the door first time; kitchens plate as the courier walks
in; ops see problems before customers do. The map must work on cheap Androids, weak signal and costly
data, in Iraqi Arabic, RTL.

## 2. Decisions (taken by Ali; do not re-litigate)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D1 | Basemap source | **Own vector basemap from OpenStreetMap** | Planetiler → PMTiles on Cloudflare R2, served by a Worker (§5.2). OSM raster (`tile.openstreetmap.org`) is dev-only and removed from production styles. |
| D2 | Phone map tech | **MapLibre native** (`@maplibre/maplibre-react-native`) | One style for web, phones and Console. Requires EAS dev-client builds (§5.1). |
| D3 | ETA / routing | **Own OSRM routing server** | All ETAs, route lines and dispatch distances become road-based and come from the API (§5.4). Supersedes plan decision 4 ("haversine × 1.4 until OSRM"). |
| D4 | Zones | **Ali places them, drivers confirm**, field team fixes in Console | Zone tool in Console + driver confirmations (§5.3). |
| D5 | Personality | **Calm, with a few special moments** | Smooth and premium by default; the special moments are almost-there and delivered (Ramadan touches were left blank, §10). Every motion respects reduced-motion. |
| D6 | GPS trail retention | **30 days, then trip summaries only** | Purge job; summaries keep distance, duration and start/end zone — no path (§5.4). Resolves the spec contradiction (schema comment "forever" vs platform-core §9 "30 days"). |
| D7 | What restaurants see about the customer | **Area name only** | Never the pin or address; heat maps are k-anonymous (§5.7). |
| D8 | Driver navigation | **Hand off to Google Maps / Waze** | No in-app turn-by-turn in this program. |

## 3. Where we are (code read, 2026-10-05)

- **Phones have no street map.** Customer and Partner native `BaseMap.tsx` render `SvgBase` (zone sketch),
  `TODO(native-map)`. Web uses `maplibre-gl` 5.24 over OSM raster. Merchant has no map at all.
- **Map code is duplicated**: `apps/customer/src/features/track/map/*` and `apps/partner/src/features/map/base/*`
  (BaseMap, SvgBase, ZoneLayer, mercator maths) are near copies.
- **Arabic labels are not drawn by MapLibre** (no glyphs; RTL plugin exported but never set): SVG overlays
  in apps, HTML markers in Console.
- **Location capture** (`apps/partner/src/lib/location.native.ts`, `features/work/useJobPositions.ts`,
  `usePresence.ts`): foreground only, one-off reads every 5 s, `at = Date.now()` (fixes up to 30 s old sent
  as fresh), accuracy never sent, device speed/heading ignored, failed reports dropped, and a fixed
  town-centre `FALLBACK_FIX` can enter dispatch. `TODO(background-location)` ×3.
- **Server intake** (`trips.reportPosition`, `contracts/src/trip.ts:156`): schema checks only — no rate
  limit, accuracy gate, timestamp sanity or spoof check. Every fix lands in `trail_points` (monthly
  partitions, PostGIS); only `lastTrailPoint` is read; no purge.
- **ETA** is haversine × factor ÷ speed in five places with three constant sets (`dispatch/geo.ts`,
  `contracts/src/tracking.ts travelMinutes`, `catalog/storefront.ts`, customer `track/eta.ts`,
  `merchant/board.ts`). No routing engine; route lines are straight; the three Tigris bridges are ignored.
- **Zones**: 34 AI-drafted centroids + radius → hexagons (`contracts/src/aziziyah-zones.ts`) decide fares
  (`pricing/engine.ts zoneFare`). `zones.polygon` (PostGIS, `verified_at`) exists but is never read;
  `ZoneResolver.register()` is never called; nothing sets `verifiedAt`.
- **Addresses**: `Place` has `landmark`, `landmarkState`, `arrivalSamples` (unused; `PlacesService.reinforce`
  has no callers). Gate photos are saved but never reach drivers (`PartnerJobStop` has pin, label, note).
- **Live channel is solid**: tRPC SSE + Redis bus (`docs/api/live.md`), position fan-out ≤ 1 / 2 s / driver.
- **Push is broken silently**: no EAS `projectId`, so `getExpoPushTokenAsync` fails. No `development`
  EAS profile, no `expo-dev-client`, no `expo-task-manager`.
- Good foundations to keep: customer tracking overlay and camera framing (`TrackMap.tsx`, `Overlay.tsx`),
  arrival screen with cash and change (`Arrival.tsx`), ride move-the-map picker (`ride/RideMap.tsx PinPicker`),
  Console dispatch map with keyboard flow and ranked candidates, Merchant board courier line.

## 4. Architecture

```mermaid
flowchart LR
  subgraph Data["Map data (monthly CI)"]
    OSM[Geofabrik Iraq .osm.pbf] --> PT[Planetiler · Protomaps schema · clip Wasit + Baghdad/Kut corridor]
    PT --> PM[(R2: basemap.pmtiles)]
    FONTS[IBM Plex Sans Arabic → SDF glyph PBFs] --> R2G[(R2: glyphs/ sprites/)]
    OSM --> OSRMP[osrm-extract/partition/customize · car, motorbike, tuktuk]
  end
  PM --> W[Cloudflare Worker /tiles/{z}/{x}/{y}.mvt · edge cache]
  OSRMP --> OS[OSRM server on Fly]
  subgraph API["apps/api"]
    LOC[location intake · guards] --> TRL[(trail_points 30d)]
    LOC --> LIVE[live fan-out SSE]
    RT[routing port → OSRM · fallback haversine] --> ETA[eta service · learned correction]
    ETA --> LIVE
    ZN[zones · polygons · ST_Contains] --> PR[pricing] & DSP[dispatch]
    RT --> DSP
  end
  OS --> RT
  subgraph Clients
    MRN[packages/map-rn · MapLibre native + web] --> CUS[customer] & PAR[partner] & MER[merchant]
    CON[console · maplibre-gl]
  end
  W --> MRN & CON
  R2G --> MRN & CON
  LIVE --> CUS & PAR & MER & CON
  PAR -- fixes (batched, timestamped, accuracy) --> LOC
```

**Package boundaries**

- `packages/map` — pure, no React: style builder (light/dark/lite), palettes from `@driver/design-tokens`,
  layer ids, zone/landmark GeoJSON builders, geo maths, **motion predictor** (§5.5), sunrise/sunset. Unit
  tested in Node.
- `packages/map-rn` — **new**: React Native map runtime shared by customer, partner and merchant:
  `<DriverMap>` (native MapLibre / web maplibre-gl / SVG fallback), camera controller, marker layers
  (courier, pins, landmarks), route layer, attribution, offline-pack helper, lite-mode detection. Replaces
  the duplicated `track/map/*` and `features/map/base/*`.
- `apps/console` keeps `maplibre-gl` directly but takes style, palettes and the motion predictor from
  `packages/map`.
- `apps/api` — new modules `routing` and `eta`; `trips` intake hardened; `places`/`dispatch` read zone
  polygons. Modules talk only through `index.ts`.

## 5. Sub-projects

Ideas are referenced by their board ids. Sizes: S days · M 1–2 weeks · L 3–5 weeks (AI-assisted).

### 5.1 SP1 — Phone builds and native foundation (f1, f2, f10, q1, d6)

- **EAS**: `eas init` for customer, partner, merchant (projectId in `app.json`); add a `development`
  profile (`developmentClient: true`, internal distribution) and `expo-dev-client`. Android first; iOS
  when the Apple account exists. Push (f10) works once projectId is set — verify end to end on a device.
- **Native map (f1)**: `@maplibre/maplibre-react-native` with its Expo config plugin, version verified
  against Expo 52 / RN 0.76 new architecture **before** install (`npx expo install`). Spike decides how the
  courier marker animates without drift: native layer (ShapeSource/SymbolLayer updated per frame) vs
  MarkerView. Acceptance: marker never drifts from the street during pan/zoom; ≥ 50 fps on the reference
  low-end Android (§6).
- **Background location (f2)**: `expo-location` `startLocationUpdatesAsync` + `expo-task-manager`, Android
  foreground service with a visible notification ("درايفر يتابع موقعك أثناء الشغل"), iOS
  `UIBackgroundModes: location`. Runs only while online or on a job. Spike first: whether Expo requires
  `ACCESS_BACKGROUND_LOCATION` for the foreground-service path; if yes, prepare the Play background-location
  declaration (prominent disclosure screen + video).
- **Adaptive sampling (d6)** — named constants in `packages/contracts`:

  | State | Interval | Distance filter | Upload |
  |---|---|---|---|
  | On job, moving | 3 s | 10 m | batch every 5 s |
  | On job, stopped (speed < 1 m/s for 60 s) | 15 s | 25 m | batch every 15 s |
  | Online, idle | 30 s | 50 m | heartbeat 30 s |
  | Offline | off | — | — |

  Fixes are queued (memory + persisted, cap 500) and sent in order with their own timestamps when the
  network returns.
- **Crash and slowness reports (q1)**: Sentry (`@sentry/react-native` Expo plugin, `@sentry/nextjs`), EU
  region, PII scrubbing (no phone, name, coordinates in breadcrumbs). API already supports `SENTRY_DSN`.

### 5.2 SP2 — Our street map (f3, b1, b2, b3, b4, b5, f12)

- **Tiles (f3)**: monthly GitHub Action: Geofabrik Iraq extract → Planetiler (Protomaps basemap profile)
  clipped to Wasit + Baghdad/Kut corridor, z0–15 (overzoom to 18) → `basemap.pmtiles` on R2. A Cloudflare
  Worker serves `/{z}/{x}/{y}.mvt` from the PMTiles file with long edge-cache headers, so clients need no
  PMTiles plugin (works for maplibre-gl and MapLibre native alike). Budget: Aziziyah z10–16 ≤ 10 MB.
- **Style (b1)**: rewrite the vector branch of `buildMapStyle`: earth, landuse, water/river, roads by class
  (casing + fill), bridges emphasised, buildings from z15, POIs filtered, places; Driver palettes from
  design tokens (cream ground, soft blue river, warm road casings, accent only for our overlays). Labels
  in IBM Plex Sans Arabic SDF glyphs (built from the repo's font files, hosted on R2), Arabic-first names
  (`name:ar` → `name` → `name:en`), Western digits. Web sets the RTL text plugin; native shaping verified
  in the SP1 spike — if Arabic shaping is broken on native, zone/landmark names stay as overlay labels and
  basemap labels use `name:ar` only where shaping passes.
- **Night map (b2)**: dark palette; switch at Aziziyah sunrise/sunset (NOAA formula, pure function in
  `packages/map`, clock injected); manual override in settings.
- **Landmarks (b3)**: `Place` rows with `landmark = true` (approved by Console; photos via
  `landmark_photos`) served as GeoJSON by `places.landmarks` (ETag, cached), drawn with a sprite of
  category icons (mosque, school, market, clinic, fuel, bridge, garage). OSM POIs of the same categories
  appear at lower priority. Launch target from the playbook: 50+ landmarks with photos.
- **Offline (b4)**: native ambient cache; partner downloads an Aziziyah offline pack (z10–16) on Wi-Fi after
  sign-in; customer relies on ambient cache. Web: HTTP cache from the Worker.
- **Lite mode (b5)**: auto when device RAM < 3 GB (`expo-device`) or connection is 2G/3G (`NetInfo`), or by
  setting: no buildings, fewer labels, overlay animation at 30 fps, no pulses.
- **Attribution (f12)**: one `MapAttribution` component in `packages/map-rn`, "© OpenStreetMap
  contributors", on every map surface including Console, merchant and share page.

### 5.3 SP3 — Zones and addresses (f4, f6, a1, a2, a3, a4, a5)

- **Zone tool (f4)** — Console › النظام › المناطق: list of 34 zones with status `draft` (AI) → `placed`
  (Ali) → `confirmed`. Click to set the centre, draw the outline (terra-draw on maplibre-gl), save to
  `zones.polygon`. Polygons must not overlap (server check, ST_Intersects). Audit log entry per change.
  Changing a zone's **tier changes fees**: tier edits need the owner role and a confirm dialog listing the
  affected fare pairs (money rule — Ali approves).
- **Driver confirmation**: at a completed drop-off, occasionally (≤ 1 per driver per day, only for zones
  not yet confirmed) ask "انت هسه بمنطقة X؟ صح / لا". 3 "yes" from 2+ drivers → `confirmed`; a "no" flags
  the zone in the tool.
- **Runtime zones**: apps stop importing `AZIZIYAH_ZONES` statically; `places.zones` query (ETag) with the
  seed as offline fallback. `ZoneResolver` and dispatch `ZoneDirectory` use polygons (point-in-polygon,
  PostGIS `ST_Contains`) with nearest-centroid fallback for unplaced zones.
- **Pin picker (a1)**: generalise the ride `PinPicker` (move the map under a fixed pin, zoom, "my location"
  with accuracy ring) and use it in `PlaceEditor` on native and web.
- **Landmark address (a2)**: saved place gets `landmarkId` (nearest approved landmarks within 500 m offered
  as chips, "يم / قرب X") plus the existing free note.
- **Self-fixing pins (a3)**: on each delivered drop-off, store the courier's arrival fix (accuracy ≤ 30 m)
  in `arrivalSamples`; with ≥ 3 samples clustered within 60 m, compute the median "door point". The
  customer's pin is never moved silently: the door point is used for driver navigation and arrival
  geofences, and the place shows "الباب مأكّد" once confirmed. Wire `PlacesService.reinforce`.
- **Which gate (a4)**: optional `entrance` point on a place (second step of the picker).
- **Door photo to driver (f6)**: `PartnerJobStop` gains `photos` (signed URLs, 1 h TTL, assigned driver
  only, during the job), `landmark`, `entrance`, `doorConfirmed`. Job screen shows them; arrival opens the
  photo full-screen.
- **Call first (a5)**: stop flag `firstVisit` (no completed delivery to this place before) → driver banner
  "اتصل قبل لا توصل" with the existing masked call.

### 5.4 SP4 — Location truth, routing and one ETA (f5, f7, f8, c2, o8, D3)

- **Honest GPS (f5)**, client: send the fix's own timestamp, `accuracyM`, device speed and heading; drop
  fixes with accuracy > 50 m; never send `FALLBACK_FIX` — presence without a fix marks the driver
  "location unknown" (excluded from automatic dispatch, shown hollow in Console).
- **Intake guards**, server: ≤ 1 fix/s per driver (batch accepted), reject `at` > now + 5 s, store fixes
  older than 2 min as trail only (never live), reject implied speed > `MAX_PLAUSIBLE_SPEED_KMH` (named
  constant) between consecutive fixes, accuracy gate. All thresholds in one constants file with tests.
- **Fake GPS (o8)**: Android `mocked` flag from expo-location, teleport counter, repeated identical fixes →
  `driver_flags` row and a Console review queue. Flags never auto-penalise.
- **Routing (D3)**: OSRM (Docker `osrm-backend`, MLD) on Fly, profiles `car`, `motorbike`, `tuktuk` (custom
  Lua: tuktuk max 40 km/h, avoids motorway; motorbike allowed on narrow tracks). API module `routing` with a
  port: `route(points, vehicle) → {polyline6, distanceM, durationS}` and `table(sources, dests, vehicle)`,
  Redis cache (rounded coords, 10 min), circuit breaker, fallback to haversine × 1.4 flagged
  `estimated: true`.
- **One ETA (f7)**: API module `eta` composes kitchen ready time + leg durations (+ per-stop handover
  constant) × learned correction (EWMA per zone pair and hour bucket from completed trips, clamped
  0.7–1.6). Contract `EtaQuote { minutesLow, minutesHigh, at, basis: 'road' | 'estimated' }`. Customer
  `track/eta.ts`, `travelMinutes` call sites, storefront and merchant board all consume it; the duplicate
  constants are deleted.
- **Route lines (c2)**: active trip legs carry an encoded polyline; recomputed when the courier is > 50 m
  off-route or every 60 s; clients trim the line at the courier's projected position.
- **Dispatch**: ranker distance term uses `table` durations (bridges matter).
- **Retention (f8)**: nightly job drops `trail_points` partitions wholly older than 30 days and deletes
  older rows in the boundary partition; `trip_summaries` keep distance, duration, start/end zone. Update
  the schema comment, domain spec and privacy policy text in the same change.
- **Trail read API**: `trips.trail(tripId)` — Console roles only, Douglas–Peucker simplified, within
  retention (feeds SP8 replay).

### 5.5 SP5 — Customer tracking (c1, c3, c4, c5, c6, c7, c8, c9, c10, c11, x1, x2)

- **Motion engine (c1)**, pure in `packages/map`: snap each fix to the route polyline when within 30 m,
  advance along the polyline at estimated speed between fixes (dead reckoning capped at 15 s), blend
  corrections over 600 ms, no backward jumps under 40 m, heading from the polyline tangent. Rendered at
  display rate on the UI thread. Used by customer, merchant radar, share page and Console fleet.
- **Minutes on the map (c3)**: pill on the courier from `EtaQuote`; range when `minutesHigh − minutesLow ≥ 3`
  or `basis = estimated`; number change animates.
- **Story camera (c4)**: stage → camera rule table (restaurant close-up with prep ring while preparing;
  frame courier + restaurant on the way to pickup; follow with look-ahead on the way; frame courier + home
  inside 400 m). Any gesture → manual until "recentre". Extends the existing `TrackMap` framing.
- **Almost there (c5)**: server geofence at `NEAR_DROPOFF_M` (300) emits `courier_near` on `live.order` and a
  push when the app is backgrounded; client: haptic + sound + card with the server-computed cash amount.
- **Courier card (c6)**: photo (signed URL), first name, vehicle type and colour, last 3 plate characters,
  call/chat buttons over the map.
- **Delivered (c7)**: 900 ms Reanimated burst + check, then the existing two-tap rating; static under
  reduced motion.
- **Share page (c9)**: public SSE channel `live.share(token)` replaces 5 s polling; route + destination;
  camera respects gestures.
- **Nearby vehicles (c10)**: `ride.nearby({pin, vehicle})` → ≤ 8 free vehicles within 3 km, positions snapped
  to road and jittered 50–100 m, no ids, refresh 10 s.
- **Our vehicle icons (x1)**: top-down tuktuk, motorbike, car, van SVGs with soft shadow in `packages/ui`.
- **Sound and vibration kit (x2)**: ≤ 30 KB sounds for accepted / picked up / almost there / delivered;
  respects silent mode and an in-app switch.
- **Later**: lock-screen tracking (c8: iOS Live Activity via a widget-extension config plugin, Android
  ongoing notification), journey recap (c11: animated simplified route + shareable image).

### 5.6 SP6 — Driver experience (d1, d2, d3, d4, d5, d7, d8, d9, f9, f11)

- **Live puck (d1)** from the device stream (SP1), follow mode, heading-up, recentre.
- **Offer on the map (d2)**: route preview (OSRM), km, server-computed earnings, pickup landmark, expiry
  ring.
- **Navigation hand-off (d3)**: choose Google Maps or Waze once; native deep links with web fallback.
- **Auto-arrive (d4)**: server `armed` response + local check (≤ 60 m, speed < 10 km/h for 10 s) opens a big
  "وصلت؟" sheet. Never completes without a tap.
- **Where the orders are (d5)**: per-zone open orders + simple forecast (same hour, last 4 weeks) vs free
  drivers, zone fill on the driver map, refresh 60 s.
- **SOS (f9)**: hold 2 s; call options (ops line, police, ambulance — numbers confirmed with Ali before
  shipping); opens a `safety_incident` in Console with a live location stream until resolved; ops alarm.
- **Delivery photo (f11)**: upload through the existing object storage; 30-day retention like trails.
- **الرجعة map (d7)**: departure screen map with garage, seat fill and pickup pins in order.
- **Later**: خطوط route map (d8: parents see the vehicle only during their child's run; children's
  positions never public), two-order best order (d9: OSRM `/trip` for ≤ 3 stops on batched jobs).

### 5.7 SP7 — Restaurant view (r1, r2, r3, r4, r5, r6, r7, k2, k3)

- **Courier radar (r1)**: radar rings around the kitchen with the courier's distance and bearing (works
  without tiles, cheap on tablets); tap for a small map. `courierView` gains `distanceM`, `bearingDeg`,
  `eta` only while the courier is heading to pickup.
- **Arriving-now chime (r2)**: under 60 s or 250 m.
- **Who's picking up (r4)**: courier photo and vehicle; 4-digit pickup code shown to the courier and checked
  by the kitchen; recorded in the handover.
- **Delivery area and fees (r5)**: zone polygons with server-computed fee bands, read-only.
- **Pickup-spot photo (r7)**: merchant uploads; shown to the courier on the pickup leg.
- **Sales insights (k2)** and **menu photo service (k3)** (field ops shoot through Partner).
- **Later**: cook on time (r3: suggested start = courier ETA to pickup − prep estimate), where my customers
  are (r6: orders per zone, last 30 days, zones with < 5 orders hidden — D7).

### 5.8 SP8 — Ops command centre (o1, o2, o3, o4, o5, b6)

- **Smooth fleet (o1)**: motion engine, heading arrows, fade after 45 s without a fix.
- **Replay (o2)**: timeline slider over `trips.trail` with events (accepted, arrived, picked up,
  delivered), 1×–16×.
- **Drag to assign (o3)**: drop sends the offer after a 3 s undo window.
- **Late before it's late (o4)**: at risk when predicted delivery (EtaQuote) > promised − 2 min; pulsing halo.
- **Supply and demand (o5)**: per-zone heat (waiting orders vs free drivers) + "send drivers here" message to
  nearby drivers.
- **Later**: missing streets (b6: trail points > 25 m from any road aggregated into candidate segments for
  the field team to add to OSM).

### 5.9 SP9 — Beyond the map (p1, p2, p3, g1, q2, q3)

- **One-tap reorder (p1)**, **order for later (p2**: `scheduledFor`, dispatch at T − (prep + travel)),
  **forgiving Arabic search (p3**: normalise alef/hamza forms, ta marbuta, ya/alef maqsura, strip
  diacritics and tatweel, dialect synonym list, `pg_trgm` similarity).
- **Invite a friend (g1)**: discount amounts are a money rule — Ali sets them; computed server-side.
- **Low-data mode (q2)**: lite map + smaller images + slower refresh on slow connections.
- **SMS fallback (q3)**: key order states by SMS when the app cannot reach the API; costs per SMS — rate
  cap and per-order maximum set with Ali.

## 6. Cross-cutting rules

- **Privacy**: trails 30 days (D6); restaurants see area only (D7); share links keep their 30 min / 24 h
  limits; door photos and courier photos via short-lived signed URLs to the assigned party only; nearby
  vehicles jittered without ids; خطوط positions only to that run's parents. Personal data stays in
  `identity_vault`.
- **Money**: fees stay server-computed. Zone tier edits (SP3), referral discounts (g1) and any driver bonus
  need Ali's approval.
- **Performance budgets** (reference device: a 3 GB-RAM Android such as a Samsung Galaxy A05):
  map first paint ≤ 1.5 s with cached tiles; courier animation ≥ 50 fps; tracking screen ≤ 1.5 MB on first
  open and ≤ 150 KB per minute while tracking; driver battery ≤ 6 % per hour on a job, screen off.
- **Arabic and RTL**: Arabic-first labels, Western digits, all copy in the locale files, Iraqi phrasing per
  the voice spec.
- **Motion**: every animation has a reduced-motion variant; no animation blocks interaction.
- **States**: every map surface has loading, empty, error, offline and "location unknown" states.

## 7. Order of work

| Wave | Sub-projects | Gate |
|---|---|---|
| A — before launch | SP1, SP2, SP4 in parallel; SP3 zone tool first (needs Ali ≈ 30 min), then addresses | Phase-0 items done: f1–f12, b1, b3, a1, q1 |
| B — customer wow | SP5 (minus c8, c11), SP6 essentials (d1–d4, d6 done in SP1, f9, f11) | real-device test on reference Android |
| C — drivers, kitchens, ops | SP6 rest (d5, d7), SP7 (minus r3, r6), SP8 (minus b6), SP9 | — |
| D — later | c8, c11, d8, d9, r3, r6, b6 | after launch is stable |

Each sub-project: implementation plan (writing-plans) → build in small commits → typecheck, lint, tests →
screenshots on web and a real Android → Ali reviews.

## 8. Testing

- Pure logic in `packages/map` and API (motion predictor, ETA composition and correction, intake guards,
  retention cut-offs, sunrise/sunset, Arabic normalisation, zone point-in-polygon) — unit tests with
  injected clocks.
- OSRM adapter: contract tests against recorded responses; fallback path tested with the breaker open.
- Map style: Playwright screenshots of the web map at fixed cameras (light, dark, lite) as the visual
  regression suite planned in the dispatch spec.
- Devices: every wave ends with a dev-client run on the reference Android (background tracking with screen
  off for 20 minutes, offline pack, fps overlay).

## 9. Running costs

| Item | Cost |
|---|---|
| Expo account, EAS free tier | free to start |
| Google Play Console | $25 once |
| Apple Developer (iOS, later) | $99 / year |
| Cloudflare R2 + Worker for tiles, glyphs, sprites | ≈ $0–5 / month |
| OSRM server (Fly, small machine) | ≈ $10–20 / month |
| Sentry | free tier |
| SMS fallback (q3) | per message, capped |

## 10. Parked (left blank on the board)

o6 incident layer, o7 TV-wall map, x3 Ramadan touches, x4 weather on the map, p4 your usuals, s1 safer
rides for women, s2 delivery PIN, k1 prep time that learns, k4 driver goals, k5 shift booking, g2 WhatsApp
updates, g3 new-area launch kit. Ali can switch any of them to Yes on the board.

## 11. Open questions for Ali

1. Do the Expo account and Google Play Console account exist yet? (Blocks SP1: phone map, background
   tracking, push.)
2. Emergency numbers and the ops line for the SOS button.
3. A real cheap Android to use as the reference test phone.
