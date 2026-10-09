# The map: where it is hosted

The apps draw Aziziyah and Wasit from our own vector map, built from Overture's open data by
`tools/map-tiles/`. The built files are never committed. The **Map tiles** workflow builds them and
publishes them to a public Supabase Storage bucket called `map`, on the same Supabase project as the
environment's database. It runs by hand (Actions → Map tiles → pick `staging` or `production`) and on
the 1st of every month, so the map follows Overture's monthly releases. A scheduled run waits for the
same "Review deployments" approval as any other staging run.

| File                                  | What it is                                                                         | URL the apps use                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `wasit.pmtiles` (about 11 MB)         | the vector map; the apps read only the parts on screen (HTTP Range requests)       | `https://<ref>.supabase.co/storage/v1/object/public/map/wasit.pmtiles`                 |
| `fonts/<fontstack>/<start>-<end>.pbf` | Arabic label glyphs: IBM Plex Sans Arabic Regular, Medium and Bold, 21 ranges each | `https://<ref>.supabase.co/storage/v1/object/public/map/fonts/{fontstack}/{range}.pbf` |

`<ref>` is the Supabase project ref: staging is `lapigvjdsuapfexzdcvl`.

Supabase serves these with CORS open to every site, answers Range requests, and caches them on its CDN.
On the free plan this fits in the 1 GB of storage and 5 GB a month of downloads while only testers
use it; Supabase Pro (approved for launch) raises both.

## Settings

- **GitHub environment** (`staging`, later `Production`):
  - variable `DATABASE_REF`, the Supabase project ref (staging already has it);
  - secret `SUPABASE_SECRET_KEY`, from Supabase → Project Settings → API Keys → a **secret** key. Paste it
    only into GitHub, never into chat.
- **App builds**: the apps read the URLs at build time.
  - Customer, partner and merchant: `EXPO_PUBLIC_MAP_TILES_URL` and `EXPO_PUBLIC_MAP_GLYPHS_URL`.
  - Console: `NEXT_PUBLIC_MAP_TILES_URL` and `NEXT_PUBLIC_MAP_GLYPHS_URL`.
  - The web builds on Vercel need the same variables set there.
  - Until they are set, the apps keep the OSM raster fallback.

Each run ends by checking, as the web app would, that the map answers a Range request with a CORS
header and that a glyph file loads. The URLs to use are in the run's summary.
