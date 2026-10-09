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
animation loop). On phones the native map needs a development build (`@maplibre/maplibre-react-native`);
until then the web studio shows the real map and the phones keep the zone sketch.

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
