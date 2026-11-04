"""The town's streets for the API's route lines (Ali 2026-11-01: lines follow the streets): every street our
map draws inside the Aziziyah town box, as polyline6 strings in apps/api/src/modules/routing/street-data.ts.
The API routes over them (@driver/map/pieces/street-route) to give each route its street shape, so the
customer, the courier and the share page all see the same line along the same streets the map shows.

Two sources, same result:
  python3 tools/map-tiles/streets.py                       # data/segment.json (after build.sh fetched it)
  python3 tools/map-tiles/streets.py path/to/wasit.pmtiles # the roads layer of a built tile file (z16)
Run it again whenever the tiles are rebuilt from new map data.
"""
import gzip, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'apps', 'api', 'src', 'modules', 'routing', 'street-data.ts')
# The town box (as the houses in build.py): where couriers, taxis and tuktuks drive.
BOX = (44.97, 32.85, 45.14, 32.97)
# Streets cars use (build.py's CLS without paths, footways, steps and cycleways).
CAR = {'trunk', 'motorway', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service',
       'living_street', 'track', 'unknown'}
ZOOM = 16


def enc(v):
    v = ~(v << 1) if v < 0 else v << 1
    out = ''
    while v >= 0x20:
        out += chr((0x20 | (v & 0x1f)) + 63)
        v >>= 5
    return out + chr(v + 63)


def polyline6(coords):
    s, plat, plng = '', 0, 0
    for lng, lat in coords:
        la, ln = round(lat * 1e6), round(lng * 1e6)
        s += enc(la - plat) + enc(ln - plng)
        plat, plng = la, ln
    return s


def inside(p):
    return BOX[0] <= p[0] <= BOX[2] and BOX[1] <= p[1] <= BOX[3]


def runs_inside(coords):
    """The parts of a line inside the box (whole points only; the box edge is far out of town)."""
    run = []
    for p in coords:
        if inside(p):
            run.append(p)
        else:
            if len(run) > 1:
                yield run
            run = []
    if len(run) > 1:
        yield run


def clip_segment(a, b, ext):
    """The part of the segment a→b inside the tile [0, ext]² (Liang–Barsky), or None."""
    t0, t1 = 0.0, 1.0
    dx, dy = b[0] - a[0], b[1] - a[1]
    for p, q in ((-dx, a[0]), (dx, ext - a[0]), (-dy, a[1]), (dy, ext - a[1])):
        if p == 0:
            if q < 0:
                return None
            continue
        t = q / p
        if p < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return (a[0] + t0 * dx, a[1] + t0 * dy), (a[0] + t1 * dx, a[1] + t1 * dy)


def clip_to_tile(line, ext):
    """The runs of a tile's line inside the tile itself (its buffer cut off at the edge)."""
    run = []
    for a, b in zip(line, line[1:]):
        c = clip_segment(a, b, ext)
        if c is None:
            if len(run) > 1:
                yield run
            run = []
            continue
        s, e = c
        if run and run[-1] == s:
            run.append(e)
        else:
            if len(run) > 1:
                yield run
            run = [s, e]
        if e != (b[0], b[1]):  # left the tile
            yield run
            run = []
    if len(run) > 1:
        yield run


def from_segments(path):
    for f in json.load(open(path))['features']:
        p, g = f['properties'], f['geometry']
        if p.get('subtype', 'road') != 'road' or p.get('class', 'unknown') not in CAR or g['type'] != 'LineString':
            continue
        yield [(round(x, 6), round(y, 6)) for x, y in g['coordinates']]


def from_pmtiles(path):
    import mapbox_vector_tile
    from pmtiles.reader import MmapSource, Reader

    def tile_xy(lng, lat):
        n = 2 ** ZOOM
        return int((lng + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)

    with open(path, 'rb') as fh:
        r = Reader(MmapSource(fh))
        x0, y1 = tile_xy(BOX[0], BOX[1])
        x1, y0 = tile_xy(BOX[2], BOX[3])
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                data = r.get(ZOOM, x, y)
                if not data:
                    continue
                if data[:2] == b'\x1f\x8b':
                    data = gzip.decompress(data)
                layer = mapbox_vector_tile.decode(data, default_options={'y_coord_down': True}).get('roads')
                if not layer:
                    continue
                ext = layer.get('extent', 4096)

                def ll(px, py):
                    n = 2 ** ZOOM
                    lng = (x + px / ext) / n * 360 - 180
                    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / ext) / n))))
                    return (round(lng, 6), round(lat, 6))

                for f in layer['features']:
                    g = f['geometry']
                    lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates'] if g['type'] == 'MultiLineString' else []
                    for line in lines:
                        # Cut at the tile's own edge, with the crossing point worked out on the
                        # street itself: both tiles then end the street at the same point on the
                        # seam, and the router joins them (it merges points closer than 2 m).
                        # Keeping the buffer instead left two overlapping copies that never met.
                        for run in clip_to_tile(line, ext):
                            yield [ll(px, py) for px, py in run]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'data', 'segment.json')
    lines = from_pmtiles(src) if src.endswith('.pmtiles') else from_segments(src)
    seen, out = set(), []
    for line in lines:
        for run in runs_inside(line):
            s = polyline6(run)
            if s not in seen:
                seen.add(s)
                out.append(s)
    out.sort()
    body = ',\n'.join('  ' + json.dumps(s) for s in out)
    with open(OUT, 'w') as fh:
        fh.write('// Generated by tools/map-tiles/streets.py: do not edit. Every street our map draws in the Aziziyah\n')
        fh.write(f'// town box {BOX}, as polyline6 (lat, lng); {len(out)} street pieces.\n')
        fh.write(f'export const STREET_LINES: readonly string[] = [\n{body},\n];\n')
    print(f'wrote {OUT}: {len(out)} street pieces, {os.path.getsize(OUT) // 1024} KB')


if __name__ == '__main__':
    main()
