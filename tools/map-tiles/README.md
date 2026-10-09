# Map tiles — our own Aziziyah map file and Arabic map letters

Builds the files the Golden hour map (`packages/map/src/golden`) reads at run time. Nothing here ships
inside an app: platform hosts the output (Supabase Storage bucket `map`) and the apps load it over HTTPS
with byte ranges.

| output | size | what |
|---|---|---|
| `out/wasit.pmtiles` | ~10.7 MB | vector tiles z7–z16, Baghdad edge → Kut, every street and house in Aziziyah |
| `out/fonts/<fontstack>/<start>-<end>.pbf` | ~0.55 MB per stack | SDF glyphs, IBM Plex Sans Arabic Regular / Medium / Bold (21 ranges each) |
| `out/labels.json` | ~120 KB | label data without glyphs (named streets, places, localities, rivers) for screens that draw HTML labels |

`data/` and `out/` are git-ignored.

## Build
```sh
pnpm install                                    # the glyph step reads the brand font from node_modules
python3 -m pip install -r tools/map-tiles/requirements.txt
tools/map-tiles/build.sh                        # fetch (~3 min) + tiles (~1 min) + glyphs (~5 s)
SKIP_FETCH=1 tools/map-tiles/build.sh           # rebuild from the data/*.json already fetched
```
Needs Python 3.11+ (tested 3.13) and outbound HTTPS to the public Overture bucket
(`overturemaps-us-west-2.s3.us-west-2.amazonaws.com`, no account). No duckdb, tippecanoe or node tools.
Behind a TLS-re-signing proxy set `HTTPS_PROXY` and `MAP_TILES_CA=<ca bundle>`. The Overture release is
pinned (`OVERTURE_RELEASE`, default `2026-09-23.0`); bump it on purpose, then look at the result.

Upload `out/wasit.pmtiles` and the whole `out/fonts/` folder as they are. The font stack folder names have
spaces (`IBM Plex Sans Arabic Regular`); MapLibre requests them URL-encoded (`%20`).

## Look at it
```sh
cd tools/map-tiles/out && python3 ../serve.py 8765   # python -m http.server has no Range support; PMTiles needs it
```
then point a MapLibre page at `pmtiles://http://127.0.0.1:8765/wasit.pmtiles` and
`http://127.0.0.1:8765/fonts/{fontstack}/{range}.pbf` with `buildGoldenStyle()`.

## Layers (source-layer names)
| layer | fields | zooms |
|---|---|---|
| `roads` | `cls` highway / major / mid / minor / alley / bridge, `name` | highways z7, secondary z9, tertiary (`mid`) z11, residential z12, service z13; bridges split out from z12 |
| `water` | `kind` river (polygon) / canal (line) / centre (river centre line), `name` | big river polygons z7, canals z10–z12 |
| `landuse` | `kind` urban / farm2 / school (school yards) / green (parks, pitches) | z10, town box only |
| `palms` | — | z11, town box only (palm groves, parks) |
| `lights` | night window lights (points on about 3 homes in 10) | z15 |
| `buildings` | `hm` height m (3.6 / 6.8 / 10 by storeys; schools 2, clinics and hospitals 3, shops on main streets 1), `base`, `kind` house / mosque / tankW / tankB / hut (stair hut) / dish / deck, rail, pier (river bridges ≥ 80 m), `use` home / shop / school / civic / mosque, `tone` 0–5 roof finish, `lit` 1 when its lights are on at night | houses z14, roof pieces z15 |
| `places` | `name`, `kind`, `rank` 1–3 | z14–z15 |
| `localities` | `name`, `kind` city / town / village / hamlet / neighbourhood kinds, `rank`, `pop` | city z7 … hamlet z12 |

## What the data does not have (field work, not code)
- Building heights: `hm` is a guess (1–3 storeys from footprint area + a stable hash); roof tanks are drawn
  on about a third of houses by the same hash.
- Street names: only about 11 named streets in town.
- Aziziyah neighbourhood names, mosques and garages: not in Overture. The landmark list in
  `packages/map/src/landmarks.ts` and field ops' walk fill these.

Map data © OpenStreetMap contributors and Overture Maps Foundation (ODbL / CDLA); show the attribution.
