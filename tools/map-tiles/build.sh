#!/usr/bin/env bash
# Build the Driver basemap: out/wasit.pmtiles, out/labels.json and out/fonts/<fontstack>/<start>-<end>.pbf.
# usage: tools/map-tiles/build.sh          (fetch + tiles + glyphs)
#        SKIP_FETCH=1 tools/map-tiles/build.sh   (reuse data/*.json)
set -euo pipefail
cd "$(dirname "$0")"
TOWN=44.80,32.72,45.25,33.05     # Aziziyah and its farms: every street, house, palm grove and place
REGION=44.30,32.40,45.90,33.40   # Baghdad edge to Kut: main roads, the Tigris and canals, towns and villages
if [ -z "${SKIP_FETCH:-}" ]; then
  python3 fetch.py transportation segment data/segment.json "$TOWN"
  python3 fetch.py base land_cover data/land_cover.json "$TOWN"
  python3 fetch.py base land_use data/land_use.json "$TOWN"
  python3 fetch.py places place data/place.json "$TOWN"
  python3 fetch.py buildings building data/building.json "$TOWN"
  python3 fetch.py transportation segment data/w_segment.json "$REGION" 'class=motorway|trunk|primary|secondary'
  python3 fetch.py base water data/w_water.json "$REGION"
  python3 fetch.py divisions division data/w_division.json "$REGION"
fi
python3 build.py
python3 glyphs.py
ls -la out
