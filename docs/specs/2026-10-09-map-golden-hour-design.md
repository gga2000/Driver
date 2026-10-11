# Golden hour (عصرية) map — design and build

Status: style and tile tools built (this PR). Screens switch over through their owners once platform hosts
the files. Decisions: Ali picked Golden hour on 2026-10-09 00:32Z, then "start now, not before launch"
at 01:27Z. Design book with every screen: https://claude.ai/artifact/LqaSx7ZkrGtwDwdvUrv55S. This
replaces the "soft blue river" line in `2026-10-05-maps-world-class.md` (no-blue brand rule).

## The idea
Aziziyah at four in the afternoon: warm earth, date-palm olive, an olive Tigris (never blue), cream streets
with caramel edges, flat roofs with water tanks. The light follows the real sun over the town, so the map
on a phone matches the street outside. Service colours (food saffron, taxi yellow, tuktuk orchid, الرجعة,
خطوط) are never in the base map; they belong to the route and pins each screen draws on top, so they pop.

## The five lights
| light | when (sun over Aziziyah) | feel |
|---|---|---|
| `day` | altitude ≥ 20° | the same town under a high sun, short soft shadows |
| `morning` | 4–20°, sun in the east | cooler cream, long grey shadows |
| `golden` | 4–20°, sun in the west | the picked look: amber roofs, long warm shadows, the river glints |
| `sunset` | −5 to 4° (maghrib) | rose-amber land, longest shadows |
| `night` | below −5° | warm brown (never navy), main streets glow like sodium lamps, no shadows |
`resolveLight({ light: 'auto' })` picks from the clock; a screen may pin one (the Console pins `day`).

## Where it is shown (`mode`)
| mode | used by | draws |
|---|---|---|
| `customer` | order tracking, ride booking, pin picker, الرجعة/خطوط maps | palm crowns z14.2+, sun shadows z15.6+, houses rise to 3D z16.4+, roof tanks z17.5+ |
| `courier` | partner app heading-up drive view (pitch ~58°) | as customer, 3D from z15.4, warm sky at the horizon |
| `console` | dispatch, control room, zones | flat colours only: no patterns, shadows, glints or 3D |
| `lite` | cheap phones (low memory / saver) | as console |

## Zoom ladder
- z7–10: the region. Tigris as a ribbon, Kut–Baghdad road, towns and villages in bold.
- z11–13: the town. Main streets cased, farms and palm groves, «العزيزية» in bold, «نهر دجلة» along the water.
- z14–15.5: streets. Every street, roofs appear, named streets labelled along the line, the town name fades out.
- z15.5–17: the door. Small streets get edges, shadows fall from the sun, important places named.
- z17+: houses in soft 3D with water tanks on about a third of the roofs.

## Labels
IBM Plex Sans Arabic (Regular / Medium / Bold) as our own SDF glyphs, Arabic shaped by MapLibre's RTL text
plugin, Western digits only (the tile build converts ٠–٩). Labels sit above everything an app adds when the
app inserts its layers before `GOLDEN_FIRST_LABEL`.

## Files
- `packages/map/src/golden/` (its own entry, `@driver/map/golden`, so apps that do not draw it carry none of it) — `buildGoldenStyle({ pmtilesUrl, glyphs, light, now, mode })`, the palettes,
  `sunAt` / `lightFor`, sun-direction shadows (`shadowOffset`), and the palm-crown pattern (`goldenImages`).
- `tools/map-tiles/` — fetch (Overture, public), tile build (`wasit.pmtiles`), glyph build. See its README.
- Hosted by platform (Supabase Storage bucket `map`, public, Range + CORS):
  `…/storage/v1/object/public/map/wasit.pmtiles` and `…/map/fonts/{fontstack}/{range}.pbf`.

## How a screen switches over (drop-in for each owner)
Read the two URLs from the app's public build env:
- Expo apps: `EXPO_PUBLIC_MAP_TILES_URL`, `EXPO_PUBLIC_MAP_GLYPHS_URL`. Console: `NEXT_PUBLIC_MAP_TILES_URL`,
  `NEXT_PUBLIC_MAP_GLYPHS_URL`. The API does not need them.

The original map (today's street picture, `buildMapStyle`) stays as the fallback, in two places (Ali,
2026-10-09: "use the original map as fallback"):
- `chooseMapStyle()` gives the Golden hour map only when both URLs are set, otherwise the original map.
- `fallBackToOriginalMap(map)` swaps to the original map once if our map file fails or does not answer
  within 10 s before it first loads. After it has loaded, a single failed tile is left to MapLibre's retry.
  A new style drops the screen's own layers, so re-add routes and pins in `onFallback` (or on `style.load`).
```ts
import { Protocol } from 'pmtiles';                       // add `pmtiles` to the app
import maplibregl from 'maplibre-gl';
import { RTL_TEXT_PLUGIN_URL } from '@driver/map';
import { chooseMapStyle, fallBackToOriginalMap, goldenImages, resolveLight, GOLDEN_FIRST_LABEL } from '@driver/map/golden';

maplibregl.addProtocol('pmtiles', new Protocol().tile);  // once per app
maplibregl.setRTLTextPlugin(RTL_TEXT_PLUGIN_URL, true);
const { light } = resolveLight();
const { style, golden } = chooseMapStyle({ tilesUrl: TILES_URL, glyphsUrl: GLYPHS_URL, mode: 'customer', light,
  fallback: { theme: 'light' } });                        // how the original map looks on this screen
const map = new maplibregl.Map({ container, style });
if (golden) {
  for (const [id, img] of Object.entries(goldenImages(light))) map.addImage(id, img);
  const stop = fallBackToOriginalMap(map, { fallback: { theme: 'light' } });  // call stop() on unmount
}
map.on('load', () => map.addLayer(routeLayer, golden ? GOLDEN_FIRST_LABEL : undefined));
```
Rebuild the style when the light changes (check every 10 minutes; the change is a quiet cross-fade, no
animation loop). On phones the native map (`@maplibre/maplibre-react-native`, development builds only;
Expo Go keeps the zone sketch) draws the same style, street life, glint and flattened houses (see below).

## Trips on the map: routes and pins in the service colour
`goldenRouteLayers({ service, light, routeSource, pinSource, id })` draws one trip, added before
`GOLDEN_FIRST_LABEL`. Services and colours come from the design tokens (`services`): food saffron, taxi
yellow, tuktuk plum, the trips' date brown and الرجعة gold.
- Route source: LineStrings with `part: 'done' | 'ahead'`. The part already driven is a quiet dotted line;
  the road ahead is the service colour on a thin dark edge (so taxi yellow still reads on cream streets).
- Pin source: Points with `role`: `from` (restaurant or pickup, service colour), `to` (the door, ink with a
  paper ring), `vehicle` (service colour inside a white ring, with a soft halo).
- At night the brighter dark-theme colour (`services.dark[s].card.dot`) replaces the day fill, because plum
  and date brown vanish on the night map. A test holds every service at 3:1 against land and streets in
  every light.

## Not in this PR
Matte chips, curated landmark stamps, and each screen's switch-over: they land with the screen owners.
Data gaps (heights, street names, neighbourhoods, mosques, garages) need the field walk, not code.

## The order map (customer, live order)

Couriers navigate in Google Maps; this map is for the customer to enjoy watching the order. Ali,
2026-10-09: "I like the 3D design … use it as much as possible", so every moment is 3D. Design came
from 3 concepts, a roast and a taste pass (frames: `/mnt/project-files/map-design/tracking/`).

| Moment | Camera (`trackingCamera`) | On the map |
|---|---|---|
| `kitchen` (cooking) | on the restaurant, z17.1, tilt 52°, heading toward the door | restaurant lit in the service colour with warm light on the ground; the way he will come drawn in full (`plan`) |
| `on_the_way` | fit courier + door, ≤ z16.8, tilt 45°, heading toward the door | driven part quiet (40 %), road ahead cased, one glint courier → door per update |
| `near` (≈ 3 min out) | fit courier + door, ≤ z17.4, tilt 50° | same, closer |
| `arrived` | on the door, z17.9, tilt 52° | route gone, the house lit with warm light, the courier's photo at the door |

- Build the style with `riseAt: TRACKING_RISE_ZOOM` (15.2) so the town stands up for the whole ride;
  hide `golden-places` (place names fight the roofs; street names stay).
- Layers: `goldenTrackingLayers({ service, light, routeSource, glowSource, litSource })` before
  `GOLDEN_FIRST_LABEL`. The route source needs `lineMetrics: true`; its lines carry `part` =
  `plan` | `done` | `ahead`. `litSource` is the one building that matters (polygon with `hm`).
- Pins are screen markers above the map (never map layers, so no roof hides them), three shapes:
  restaurant = saffron teardrop with the food icon (dark ink); courier = 38 px photo disc (the
  approved main photo) in a 3 px service-colour ring with a small heading wedge; door = dark
  teardrop with the home icon and a cream halo.
- Motion: ease the camera `TRACKING_EASE_MS` (1.2 s) when the moment changes, never while a finger
  is on the map; one glint (`glintGradient`, `TRACKING_GLINT_MS`) after each position update, then
  rest; no idle loops. Reduce motion: jump between cameras and keep the line resting.
- Fit padding clears the header chip, courier card and sheet (≈ top 90, bottom 330 px on a phone).
- `lite` phones keep the flat customer map.

## The town and the new look (Ali, 2026-10-09: "go ahead")
- **Houses by use:** schools two storeys, hospitals and clinics three, shop rows on main streets one. Most houses carry the stair hut (بيت الدرج), some a satellite dish. River bridges of 80 m or more stand on piers.
- **Roof finishes:** six per light (`roofTones`), picked by each building's stable `tone`.
- **Sky and haze:** every tilted customer and courier view. Console and lite stay flat.
- **Up close:** a soft wall foot, pale kerbs and a dashed centre line on main streets.
- **Ground:** school yards, parks and pitches each have their own colour. Fields are drawn in rows (`golden-furrows`, z12.5–15.3), and there's a mud bank along the Tigris.
- **Night:** about 3 homes in 10 are lit (`lit`, `lights` layer), with warm light spilling onto the street. The order route stays the brightest thing.

## Street life (Ali picked "moving")
`streetLife(roads, { seed, light, moving })` builds a calm street scene from the `roads` on screen. `lifeFrame(scene, t)` turns it into small 3D blocks for the moment `t`, and `goldenLifeLayers({ source })` draws them.
- **Cars:** about 28 % of kerb slots on main streets hold a parked car. One moving car runs per ~110 m, in its lane. A few are تكتك.
- **People:** on the pavements, about 60 % of them walking.
- **Rules:**
  - Only from `LIFE_MINZOOM` (16.6).
  - Never saffron, yellow, blue or teal.
  - Fewer at night, none in alleys.
  - `moving: false` on slow phones and with reduce-motion gives a still scene.
- **For the screen owner:** read the roads with `querySourceFeatures(GOLDEN_SOURCE, { sourceLayer: 'roads' })` on `moveend`. Feed `lifeFrame()` to a GeoJSON source each animation frame while the map is at street zoom, and stop the loop below it or when the screen is hidden.
- **Phones** (`StreetLifeLayers.tsx`): every frame would cross the bridge, so the scene is split. Parked cars and people standing go to one source once per camera stop. Moving cars and walkers go to a second source about 12 times a second, paused when the app is in the background. The road-ahead glint steps about 15 times a second for its 2.4 s. On the restaurant map the house layers are adopted by id, so the houses facing a chosen shop lie flat without reloading the style.

## Lantern streets (Ali, 2026-10-11: "even the ramadan thing make it permanent")

Strings of fanous lanterns hang across the main streets of the town centre all year round. They sit within 1.7 km of the
centre, about every 26 m on `major` and `mid` roads, and sag between the shop fronts at about 5–6.4 m. The tiles carry them
in their own `lanterns` layer (z16, `tools/map-tiles/build.py`). Each lantern is a small box in the air (`base`, `hm`)
with `c` 0–2, which the style colours saffron, gold or coral (`lamp1..3`): painted glass by day, brighter at sunset, lit
at night. One `glow` point per string pools warm light on the street at night (`golden-lantern-glow`). They show only up
close (from z16.4) and only in the 3D modes; the Console and cheap phones never draw them. They come on with the light
change at dusk (the style swap), and nothing pulses or loops.

## Map pieces for the new ideas (Ali, 2026-10-11: "apply them all")

These are pure helpers in their own entry point `@driver/map/pieces` (so an app carries them only once a screen imports them); each screen's owner wires them (plan:
`/mnt/project-files/map-design/next-ideas/build-plan.md`). Points are `[lng, lat]`. Streets come from the screen's own
map via `roadsFromFeatures()` (also in `@driver/map/golden`); the customer `BaseMap` hands them over with `onRoads`.
- **N10 Walk to a safe stop** (`walk.ts`): `safeStopFor(pin, roads, landmarks)` returns a stop on a mid, major or
  highway road within 250 m, preferring one by a landmark when it costs under 40 m more walking. It returns null when
  the pin is already within 25 m of such a road. `walkToStopGeoJSON(from, to, k)` draws the dotted walk once over
  `WALK_DRAW_MS` (1.5 s); `walkToStopLayers`, `walkColours`.
- **N6 Why it's late** (`moments.ts`): `slowStretchGeoJSON(path, fromM, toM, label)` with `slowStretchLayers` (rust and
  cream stripes, a label). No money rule changes.
- **N16 The tablet sees the courier**: `shopWarmGeoJSON(at)` with `shopWarmLayers`, a warm pool that fades in once.
- **N12 Seats at the garage** (`garage-seats.ts`): `GARAGE_BAYS` (generated from the garage model by
  `tools/map-tiles/garage_bays.py`), `garageSeatsGeoJSON(cars)` (one block per seat in two rows floating 8.8–10 m up, clear of the wave roof, gold for
  free, date brown for taken, each carrying the car id) and `garageSeatLayers`.
- **N14 Only your home and the bus** (`khat.ts`): `khatRouteGeoJSON({ route, bus, school, mine, others })`. Other
  stops are fractions along the route, never coordinates; they draw as blank dots.
- **N17 Where the orders are** (`demand.ts`): `demandGlowGeoJSON(cells)` with `demandGlowLayers`. Amber, never red;
  cells under 0.15 stay dark; updates cross-fade over 2 s and nothing pulses.
- **N4 Sunrise over Aziziyah** (`sunrise.ts`): `sunriseTour()` gives 8 s of keyframes from low over the Tigris towards
  the town, with the light stepping night, then morning, then day. It plays once, a tap skips it, and reduce motion
  shows the last frame.

## Landmarks in 3D (Ali, 2026-10-09: "not real spot, make good looking design for each")

The main mosque, the hospital and the three town garages stand up as detailed models, built in metres by
`tools/map-tiles/landmarks.py` and shipped in the tiles' `landmarks` layer (`lm`, `part`, `hm`, `base`). The style
colours each part per light (`GoldenPalette.landmark`) and raises them at `LANDMARK_RISE` (z14.6), before the houses,
so they guide the eye from further out; the Console and cheap phones draw their plan flat.

- **Main mosque**: walled courtyard with palms and a fountain, prayer hall with an arcade, a tall iwan with a gold-tiled
  arch, a gilded dome on its drum with four small domes, two banded minarets with a call balcony. Floodlit at night.
  Ramadan lantern strings (`lamp1..3`, kept all year) run from each minaret's balcony down to the corners and the gate,
  and warm pools light the courtyard and the gate at night.
- **Hospital**: white L-shaped blocks with floor bands, a red crescent on a white roof disc, an entrance canopy with two
  ambulances and a red sign, parking and palms along the fence.
- **Garages** (the new terminal, Ali's pick of three looks on 2026-10-10): a wave of white fins over two rows of bays,
  each fin edged in saffron that lights up at night (`led`), a middle island with palms and benches where people wait,
  H-1 minibuses, GMCs and Coasters with bags on their racks, a glass waiting hall (`hall`, glowing at night), a tea
  kiosk with chairs, a totem in the destination colours (`dest1..3`) and taxis at the kerb. At night `pool` parts throw
  warm light on the ground through their own see-through layer (`golden-landmark-pools`); they are never solid.

The mosque and hospital spots are design spots (empty lots beside a main road, off the river), not surveyed ones; the
garages stand at Ali's real spots (2026-10-10), each lot sized to fit between its streets (`GARAGE_SIZE`). The houses
Overture has on a lot give way to the model. The garage pins the apps use (`GARAGES`, seed data, intercity config) still sit at the old
demo spots; moving them onto the models belongs to the garage data owner.

## Your trips map (stats «خريطتك», 2026-10-11)
- `@driver/map/pieces`: `myTripsGeoJSON(trips, {labels, k?, pins?})`, `myTripsLayers({source, light})`, `myTripsBounds(trips)`,
  `myTripWidth(count)`, `MY_TRIPS_DRAW_MS` (1200), `MY_TRIPS_PINS_MS` (300) and `MY_TRIPS_CAMERA` (pitch 40, bearing −12).
- Soft arcs from each kitchen or pickup to where the trip ended (the server knows the ends, not the streets), coloured
  by service, three widths by count, on a cream under-stroke and a light cream fade over the town. Kitchens are saffron
  circles with the meal count, home an ink dot in a cream ring, and each الرجعة trip a 650 m dashed arrow out of its
  garage towards Baghdad or Kut with the app's own words. Lines draw once, pins come in after, then nothing moves.
