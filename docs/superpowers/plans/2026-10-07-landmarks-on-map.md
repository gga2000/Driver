# Landmarks on the map (maps program b3) — plan

**Goal:** every map in the apps (customer live order, share page, place editor, partner `DriverMap`,
Console live map) shows the town's approved landmarks — the mosque, the school, the market, the bridge —
as small quiet icons under our own pins, with their names when zoomed in, so a customer or a driver can
say «يم الجامع» and see it.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.2 b3 (Ali approved on the map board).

## What exists

- `places` rows with `landmark = true` and `landmark_state` (Prisma saves `approved`); the in-memory twin
  has no state. `PlacesService.landmarks(cityId)` reads them, but does not filter on the state.
- `AZIZIYAH_LANDMARKS` (contracts): three garages and six meeting points, not rows. `cityLandmarks()`
  merges them with the learned rows into `LandmarkView` (the «وين رايح؟» search and the «قرب شنو؟» chips).
- `landmark_photos` (ops module): field ops propose, the Console approves (`landmark_photo` kind).
- No category anywhere; no ETag pattern anywhere (the zones query is a plain query refetched every 30 s).
- `packages/map/src/labels.ts`: zone names hide near markers (`labelsClearOf`), pin names flip
  (`pinLabelSide`).

## Decisions

1. **Category**: `LandmarkCategory = mosque | school | market | clinic | fuel | bridge | garage | other`
   (contracts). New nullable column `places.landmark_category` (migration `20261007225000_landmark_category`,
   with a CHECK on the values; no new table). A row without one, and every seed, gets
   `landmarkCategoryOf(name, kind)` — a pure rule on the Arabic name (جامع/مسجد/حسينية → mosque,
   مدرسة/كلية/جامعة/روضة → school, سوق/مول → market, مستشفى/مستوصف/عيادة/صيدلية → clinic, محطة وقود/بانزينخانة →
   fuel, جسر → bridge, كراج → garage; a seed of kind `garage` is a garage) so seeds need no copied field.
2. **Approved only**: `PlacesRepository.landmarks()` returns rows with `landmark_state = 'approved'`
   (in memory: `landmarkState` absent or `approved`). Seeds count as approved (they ship in code). Saved
   places (`label` set) never appear (separate repository, `label IS NULL` in SQL).
3. **One feed, `places.landmarkFeed`** (public: the share page has no session; landmarks are public city
   knowledge and the items carry no owner, note or zone). Input `{ cityId, etag? }`; output a union on
   `changed`: `{ changed: false, etag, maxAgeS }` or `{ changed: true, etag, maxAgeS, landmarks[] }`, each
   item `{ id, name_ar, category, pin, photoUrl | null }`. tRPC batches POST/GET bodies, so HTTP
   `If-None-Match` cannot work through the batch link: the ETag travels in the input instead (same effect —
   an unchanged feed costs ~60 bytes).
   - `etag` = short SHA-1 of the stable content (ids, names, categories, pins rounded to 6 dp, photo
     upload ids), plus the day when any photo is a signed URL (signed photo links are made valid for
     `LANDMARK_FEED_RULES.photoValidMs` = 2 days, so a phone never keeps a dead link).
   - The server keeps the built feed per city for `serverTtlMs` (60 s); approving a landmark photo or
     saving a landmark place drops it.
   - Phones: React Query with `staleTime = maxAgeS` (6 h), sending the last etag; the pure
     `mergeLandmarkFeed(prev, res)` keeps the old list on `changed: false`.
4. **Photo**: the place's own photo (`place_photos`) first, else the newest approved `landmark_photos`
   upload for that landmark (seed targets match `lm_<key>` or `<key>`), as a signed read link. The ops
   module registers the approved-photo source on the feed at start-up (`LandmarkFeedService.usePhotos`,
   like `PlacesService.registerZones`), so places never imports ops (ops already imports places).
5. **Icons**: stroke glyphs on the 24-px grid like `@driver/ui` icons, kept as data in `@driver/map`
   (`LANDMARK_GLYPHS`) because the Console (Next.js, no `@driver/ui`) draws them too; `garage` is the very
   `garage` drawing of `@driver/ui` (a test keeps them equal). `@driver/ui` gets `GlyphShapes` (draws
   shapes inside an existing `<Svg>`). Colours: `design-tokens` neutrals only — a cream disc, warm ink
   glyph, the accent stays for our own pins.
6. **Where they are drawn**: a `LandmarkLayer` inside each app's `BaseMap` (SVG base and the MapLibre
   web base), after the zone names — so it is under every pin, route and courier marker of `TrackMap`,
   `ShareMap`, `PinPicker`, `RideMap` and `DriverMap`. Console: HTML markers in the existing label
   placement (`placeLabels`), kind `landmark`, priority between zones and garages; garages skipped there
   (the garage layer already draws them).
7. **Visibility rules** (pure, `packages/map/src/landmarks.ts`): icons from zoom 15, names from 16; lite
   mode (`useLiteMode`) from 16 and at most 6, no names; at most 40. Greedy placement by category
   priority (mosque, bridge, market, school, clinic, fuel, garage, other), then nearest the middle:
   an icon that would touch a marker's keep-out box (pins' pills rise ~70 px, so a box above and around
   each marker; the centre pin its own narrow box), a zone name, the bars the screen covers (top bar,
   sheet: `coveredTop` / `coveredBottom` on the base map, added after the first screenshots showed a
   badge half under the share page's sheet), or a placed landmark is dropped; a name that would is
   dropped alone, the icon stays.
8. **No tap** for now (the spec makes it optional; nothing on these screens needs it yet).
9. **Demo**: `seedDemoLandmarks()` (places module) adds a handful of approved landmark places with
   categories around the centre, شارع 30 and زاكور, idempotent by name; the customer, partner and
   Console demo APIs call it. Around the demo home: mosque and market ~100 m north and south (the
   customer's tall door camera at zoom ~17), clinic and school ~150 m west and east (the courier's
   wide, short job map at 15.4).
10. **Copy**: no new strings (names come from data, the layer is decorative and hidden from screen
    readers, like the zone names).

## Tasks

- [x] Contracts: `LandmarkCategory`, `landmarkCategoryOf`, `LANDMARK_FEED_RULES`, feed schemas, `Place`
      `landmarkCategory`/`landmarkState`, `LandmarkView.category`, `PlacesPort.landmarkFeed`, router; tests.
- [x] DB: schema field + migration.
- [x] API: repository (approved filter, category column), `LandmarkFeedService` (+ pure build/etag),
      ops photo source + invalidation, demo seeder; tests (approved only, etag, not-modified, photos,
      router public read).
- [x] Map package: `landmarks.ts` (rules, priority, placement, feed merge) and `landmark-icons.ts`; tests.
- [x] UI: `GlyphShapes`; test.
- [x] Customer + partner: `useLandmarkFeed`, `LandmarkLayer`, wired into both bases.
- [x] Console: landmark markers on the live map.
- [x] Demo seeding in the three demo APIs.
- [x] `docs/api/landmarks.md`.
- [x] typecheck, lint, tests; screenshots (customer live map, place editor, share page, partner map).
