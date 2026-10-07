# Landmarks on the map (maps program b3)

Approved on the map board (`docs/specs/2026-10-05-maps-world-class.md` §5.2 b3). Every map draws the
town's approved landmarks — the mosque, the school, the market, the bridge — as small quiet badges under
our own pins, with their names when zoomed in, so «يم الجامع» means something on the screen. Plan:
`docs/superpowers/plans/2026-10-07-landmarks-on-map.md`.

## What a landmark is

One list, the same one «وين رايح؟» searches and the «قرب شنو؟» chips offer (`cityLandmarks`):

| Source | Id | Approved when |
|---|---|---|
| The seed (`AZIZIYAH_LANDMARKS`: three garages, six meeting points) | `lm_<key>` | always (ships in code) |
| `places` rows with `landmark = true` and `label IS NULL` | the row id | `landmark_state = 'approved'` (what a save writes; `proposed` / `rejected` rows are left out) |

A row whose pin is out of service, or whose name the seed already has, is left out. Customers' saved
places (`label` set) are never landmarks.

### Category (the icon)

`LandmarkCategory`: `mosque`, `school`, `market`, `clinic`, `fuel`, `bridge`, `garage`, `other` (a park, a
roundabout, a junction). Rows keep it in `places.landmark_category` (migration
`20261007225000_landmark_category`, CHECK on the values). A row without one, and every seed, gets
`landmarkCategoryOf(name, kind)`: a seed of kind `garage` is a garage; otherwise the first category a
whole word of the Arabic name belongs to (folded: «الجامع» = «جامع», «مدرسة» = «مدرسه») — fuel (وقود،
بانزينخانة…), garage (كراج…), bridge (جسر…), clinic (مستشفى، مستوصف، عيادة، صيدلية، صحي…), school (مدرسة،
كلية، جامعة، روضة…), mosque (جامع، مسجد، حسينية…), market (سوق، سوك، مول…) — else `other`. «جامعة» is a
school, «جامع» a mosque; «كراج السوق» is a garage.

### Photo

The place's own photo (`place_photos`) first; else the newest **approved** `landmark_photos` upload for it
(Console approvals kind `landmark_photo`; a seed matches its `lm_<key>` or bare `<key>`), as a signed read
link valid two days (`LANDMARK_FEED_RULES.photoValidMs`). None: `null`. The ops module registers the
approved-photo source on the feed at start-up and drops the built feed when a photo is approved.

## `places.landmarkFeed` (query, public)

Public: the share page has no session, and the items are city knowledge with no owner, note or zone.

```ts
input:  { cityId?: string = 'aziziyah', etag?: string }
output: { changed: false, etag, maxAgeS }
      | { changed: true,  etag, maxAgeS, landmarks: Array<{ id, name_ar, category, pin: { lat, lng }, photoUrl: string | null }> }
```

- **ETag in the input.** tRPC batches requests (several procedures in one GET), so HTTP `If-None-Match`
  cannot work through the batch link; the phone sends the etag it has and an unchanged feed answers
  `changed: false` (about 60 bytes).
- `etag`: a short SHA-1 of what a map draws — ids, names, categories, pins (6 decimals) and which photo
  (upload id, never the signed link). When any photo is a signed link the UTC day joins in, so a phone
  refreshes its links at least daily.
- `maxAgeS` = 6 hours: the phones' React Query `staleTime` (`useLandmarks`), so they ask rarely; the
  Console uses the same.
- The server builds a city's feed at most once a minute (`serverTtlMs`); approving a landmark photo
  drops it at once. A newly saved landmark place shows within that minute.
- Names come with Western digits («كراج البوابة 1»).

## On the maps

Pure rules in `@driver/map` (`placeLandmarks`, `LANDMARK_RULES`, `LANDMARK_PRIORITY`):

- icons from zoom 15, names from 16 — except the partner job map, which never zooms past 15.4: names
  from 15 there (`LANDMARK_RULES.driverNameZoom`, Ali 2026-10-07: drivers need them most); **lite mode** (`useLiteMode`): from 16, at most 6, no names; at most
  40 on a screen; lite mode never shows names, on any map;
- greedy by category — mosque, bridge, market, school, clinic, fuel, garage, other — then nearest the
  middle of the screen, then id;
- a badge never touches a marker's keep-out box (our pins' name pills rise ~70 px over the tip, about
  ±60 px wide, a flipped pill hangs ~30 px under; the place editor's centre pin keeps a narrow column),
  a zone name, the bars the screen covers (top bar, sheet) or another landmark; a name that would is
  dropped alone, the badge stays.

Where: the `LandmarkLayer` inside each app's base map (SVG base and MapLibre web base) — so under every
pin, route and courier of the customer's live order map, share page, place editor and ride map, and the
partner `DriverMap`. The Console live map draws HTML badges in its own collision-free label placement
(names as `landmark` labels), from the same zoom rules; garages are left to its garage layer. Badges are
decorative (hidden from screen readers like the zone names); tapping one does nothing yet.

Icons: `LANDMARK_GLYPHS` in `@driver/map` (stroke glyphs on the 24-px grid; `garage` is the very
`@driver/ui` garage icon), drawn by `GlyphShapes` (`@driver/ui`) inside the map's SVG, and as SVG markup on
the Console. Colours from design tokens only: a cream badge with a warm ink glyph; the accent stays for
our own pins.

## Demo

`seedDemoLandmarks` (places module) adds approved landmark places with categories around the centre,
شارع 30 and زاكور (DEMO pins and names; idempotent by name). The customer, partner and Console demo APIs
call it. Around the demo home in زاكور: the mosque ~90 m north and the market ~100 m south (the customer's
close door camera), the clinic and the school ~150 m west and east (the courier's wide job map). The
partner door card now says «قرب جامع زاكور الكبير» (maps a2).
