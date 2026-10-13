# Build wasit.pmtiles (+ labels.json) from Overture GeoJSON extracts.
# usage: python3 build.py  (reads data/*.json from fetch.py; writes out/wasit.pmtiles and out/labels.json)
import json, gzip, math, hashlib, os, sys, time
import numpy as np, shapely, shapely.affinity, shapely.geometry as sg
from shapely.ops import substring, linemerge
from shapely.strtree import STRtree
import mapbox_vector_tile as mvt
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid, TileType, Compression

HERE = os.path.dirname(os.path.abspath(__file__))
TOWN = WIDE = os.path.join(HERE, 'data')
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
RELEASE = os.environ.get('OVERTURE_RELEASE', '2026-09-23.0')
L = lambda d, n: json.load(open(os.path.join(d, n + '.json')))['features']
H = lambda s: int(hashlib.md5(s.encode()).hexdigest()[:8], 16)
MINZ, MAXZ, EXT, BUF = 7, 16, 4096, 64
REGION = (44.30, 32.40, 45.90, 33.40)
TOWNBOX = (44.80, 32.72, 45.25, 33.05)
CENTER = (45.060, 32.906)

import re
AR = re.compile('[\u0600-\u06FF]')
WESTERN_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
def nm(p):
    names = p.get('names') or {}; n = names.get('primary')
    if n and not AR.search(n):   # prefer the Arabic common name when the primary one is not Arabic
        com = names.get('common') or []
        com = com.items() if isinstance(com, dict) else com
        n = next((v for k, v in com if k == 'ar'), n)
    if not n: return None
    n = n.translate(WESTERN_DIGITS)   # voice rule: Western digits 0-9 on every screen, the map included
    return re.sub(r'\s*\([A-Za-z ]+\)', '', n).strip()

# ---------------- features: (layer, geom, props, minzoom, maxzoom) ----------------
F = []
TOWNPOLY = sg.box(*TOWNBOX)
def add(layer, g, props, zmin, zmax=MAXZ):
    if g is None or g.is_empty: return
    if layer in ('landuse', 'palms') and not TOWNPOLY.contains(g):
        g = g.intersection(TOWNPOLY)   # town-only extract: cut cleanly at the town box
        if g.is_empty or g.area == 0: return
        if g.geom_type == 'GeometryCollection': g = shapely.union_all([q for q in g.geoms if 'Polygon' in q.geom_type])
    F.append((layer, g, {k: v for k, v in props.items() if v is not None}, zmin, zmax))

# roads ---------------------------------------------------------------
CLS = {'trunk': 'highway', 'motorway': 'highway', 'primary': 'major', 'secondary': 'major', 'tertiary': 'mid',
       'residential': 'minor', 'unclassified': 'minor', 'service': 'alley', 'living_street': 'minor', 'track': 'alley',
       'unknown': 'minor', 'path': None, 'footway': None, 'pedestrian': None, 'steps': None, 'cycleway': None}
def road_parts(p, g, c):
    fl = p.get('road_flags') or []
    br = [x.get('between') or [0, 1] for x in fl if 'is_bridge' in (x.get('values') or [])]
    if not br: return [(g, c)]
    a, b = br[0]; out = []
    for s, e, cc in ((0, a, c), (a, b, 'bridge'), (b, 1, c)):
        if e - s < 1e-6: continue
        sub = substring(g, s, e, normalized=True)
        if sub.length > 0: out.append((sub, cc))
    return out
def road_zoom(cls_src, c):
    if cls_src in ('motorway', 'trunk', 'primary'): return 7
    if cls_src == 'secondary': return 9
    if c == 'mid': return 11         # tertiary
    if c == 'minor': return 12
    return 13                        # alley / track / service

town_seg = [f for f in L(TOWN, 'segment') if f['properties'].get('subtype', 'road') == 'road']
town_ids = {f['properties']['id'] for f in town_seg}
wide_seg = [f for f in L(WIDE, 'w_segment') if f['properties']['id'] not in town_ids]
for f in town_seg + wide_seg:
    p = f['properties']; src = p.get('class'); c = CLS.get(src, 'minor')
    if not c: continue
    g = sg.shape(f['geometry']); n = nm(p); z0 = road_zoom(src, c)
    # below z12 one unsplit line; from z12 bridge parts are split out as cls=bridge
    if z0 < 12: add('roads', g, {'cls': c, 'name': n}, z0, 11)
    for part, cc in road_parts(p, g, c):
        add('roads', part, {'cls': cc, 'name': n}, max(z0, 12))

# water (regional extract covers the town too) ---------------------------------
river_lines = []; river_polys = []
for f in L(WIDE, 'w_water'):
    p = f['properties']; g = sg.shape(f['geometry']); st = p['subtype']; n = nm(p)
    if g.geom_type in ('Polygon', 'MultiPolygon'):
        a = g.area * 1e6  # ~ (100 m)^2 units
        z0 = 7 if a > 300 else 9 if a > 30 else 11 if a > 3 else 13 if a > 0.3 else 99
        if z0 < 99: add('water', g, {'kind': 'river', 'name': n}, z0)
        if a > 3 and g.intersects(TOWNPOLY): river_polys.append(g)
    elif g.geom_type in ('LineString', 'MultiLineString'):
        if st == 'river':
            add('water', g, {'kind': 'centre', 'name': n}, 7); river_lines.append((n, g))
        elif st == 'canal':
            add('water', g, {'kind': 'canal', 'name': n}, 10 if n else 11)
            if n: river_lines.append((n, g))
        elif st in ('stream', 'drain', 'ditch'):
            add('water', g, {'kind': 'canal', 'name': n}, 12)
# the Tigris has depth (map audit, 2026-10-12): bands from the bank to the middle, light and silty at the edge and darker
# where it runs deep (`d` 0 the whole river … 6 in the channel), and reeds along the bank (points, kind `reed`, `s` 0–2).
# Within RIVER_M of the centre, from z12; the style lays the bands over the river's own colour.
DEPTH_M = [0, 4, 9, 16, 25, 36, 50]
lat0 = 32.9; mx = 111320 * math.cos(math.radians(lat0)); my = 110540
import random as _rnd
_rr = _rnd.Random(3)
RIVER_M = 4500   # around the town only: the view people zoom into
_near_r = sg.Point(CENTER[0] * mx, CENTER[1] * my).buffer(RIVER_M)
for g in river_polys:
    gm = shapely.affinity.scale(g, mx, my, origin=(0, 0)).buffer(0).intersection(_near_r)
    if gm.is_empty: continue
    for k, w in enumerate(DEPTH_M):
        band = gm.buffer(-w) if w else gm
        if band.is_empty: break
        add('water', shapely.affinity.scale(band.simplify(1.5), 1 / mx, 1 / my, origin=(0, 0)), {'kind': 'depth', 'd': k}, 12)
    edge = gm.boundary; d = 0.0
    while d < edge.length:
        pt = edge.interpolate(d); d += _rr.uniform(8, 20)
        if pt.distance(_near_r.boundary) < 5: continue   # not along the cut at the edge of the radius
        for _ in range(_rr.randint(1, 2)):
            q = sg.Point(pt.x + _rr.uniform(-2.5, 2.5), pt.y + _rr.uniform(-2.5, 2.5))
            add('water', sg.Point(q.x / mx, q.y / my), {'kind': 'reed', 's': _rr.randint(0, 2)}, 15)

# landuse + palms (town extract only) ---------------------------------------------
def poly_zoom(g, base):
    a = g.area * 1e6
    return base if a > 20 else max(base, 12) if a > 2 else max(base, 13) if a > 0.3 else 14
for f in L(TOWN, 'land_cover'):
    s = f['properties']['subtype']; g = sg.shape(f['geometry'])
    if s in ('forest', 'shrub'): add('palms', g, {}, poly_zoom(g, 11))
    elif s in ('crop', 'grass', 'wetland'): add('landuse', g, {'kind': 'farm2'}, poly_zoom(g, 10))
    elif s == 'urban': add('landuse', g, {'kind': 'urban'}, poly_zoom(g, 10))
for f in L(TOWN, 'land_use'):
    s = f['properties']['subtype']; g = sg.shape(f['geometry'])
    if s == 'residential': add('landuse', g, {'kind': 'urban'}, poly_zoom(g, 10))
    elif s in ('agriculture', 'horticulture'): add('landuse', g, {'kind': 'farm2'}, poly_zoom(g, 10))
    elif s == 'park': add('landuse', g, {'kind': 'green'}, poly_zoom(g, 12))
    elif s == 'education': add('landuse', g, {'kind': 'school'}, poly_zoom(g, 12))
    elif s == 'recreation': add('landuse', g, {'kind': 'green'}, poly_zoom(g, 12))

# buildings (no heights in Overture here: 1-3 storeys from footprint + stable hash, as convert.py) ----
lat0 = 32.9; mx = 111320 * math.cos(math.radians(lat0)); my = 110540
pois = L(TOWN, 'place')
mosq = [sg.shape(f['geometry']) for f in pois if 'worship' in (f['properties'].get('basic_category') or '')
        or any(k in (nm(f['properties']) or '') for k in ('جامع', 'مسجد', 'حسينية'))]
# bridges in 3D: the deck raised on piers with a rail each side, for the river crossings (long bridges only, so
# a culvert over a canal stays a flat road). Drawn by the style only where the town stands up in 3D.
seen = []
for ly, g, p, *_ in list(F):
    if ly != 'roads' or p.get('cls') != 'bridge': continue
    gm = shapely.affinity.scale(g, mx, my, origin=(0, 0))
    if gm.length < 80: continue
    c = gm.interpolate(0.5, normalized=True)
    if any(c.distance(o) < 20 for o in seen): continue
    seen.append(c)
    back = lambda q: shapely.affinity.scale(q, 1 / mx, 1 / my, origin=(0, 0))
    add('buildings', back(gm.buffer(6.5, cap_style='flat')), {'hm': 7.8, 'base': 6.6, 'kind': 'deck'}, 15)
    for side in ('left', 'right'):
        add('buildings', back(gm.parallel_offset(6.2, side).buffer(0.25, cap_style='flat')), {'hm': 8.7, 'base': 7.8, 'kind': 'rail'}, 15)
    for i in range(1, int(gm.length // 28)):
        add('buildings', back(gm.interpolate(i * 28).buffer(2.2, quad_segs=3)), {'hm': 6.6, 'base': 0, 'kind': 'pier'}, 15)
print('bridge decks', len(seen), file=sys.stderr)

# what a building is for, so heights follow use: school yards, clinics/hospitals, shop rows on main streets
schools = [sg.shape(f['geometry']) for f in L(TOWN, 'land_use') if f['properties'].get('subtype') == 'education']
civic = [sg.shape(f['geometry']) for f in pois if (f['properties'].get('basic_category') or '') in
         ('hospital', 'health_care', 'specialized_medical_facility', 'college_university', 'place_of_learning', 'education')]
mains = [g for (ly, g, p, *_ ) in F if ly == 'roads' and p.get('cls') in ('major', 'mid')]
main_tree = STRtree(mains); school_tree = STRtree(schools) if schools else None; civic_tree = STRtree(civic) if civic else None
def near(tree, g, m):
    return tree is not None and len(tree.query(g, predicate='dwithin', distance=m / mx)) > 0
def box(c, hx, hy):   # metres → a small lon/lat box around point c
    return sg.box(c[0] - hx / mx, c[1] - hy / my, c[0] + hx / mx, c[1] + hy / my)
# landmarks in 3D (landmarks.py): the main mosque, the hospital and the garages, each on its own lot; the houses
# Overture has on those lots give way to them
from landmarks import landmark_parts
lm_parts, lm_lots = landmark_parts(mx, my)
for gm_, p_ in lm_parts:
    add('landmarks', shapely.affinity.scale(gm_, 1 / mx, 1 / my, origin=(0, 0)), p_, 14)
lot_tree = STRtree([shapely.affinity.scale(l, 1 / mx, 1 / my, origin=(0, 0)).buffer(2 / mx) for l in lm_lots])
print('landmark parts', len(lm_parts), file=sys.stderr)
nb = nr = 0
for f in L(TOWN, 'building'):
    g = sg.shape(f['geometry'])
    if g.geom_type != 'Polygon': continue
    if len(lot_tree.query(g, predicate='intersects')): continue
    area = g.area * mx * my; h = H(f['properties']['id'])
    if area < 12: continue
    fl = 1 if area < 70 else ((2 if h % 10 < 6 else 1) if area < 350 else (2 if h % 10 < 7 else 3))
    use = 'home'
    if area > 150 and near(school_tree, g, 0): use, fl = 'school', 2            # schools: two tall storeys
    elif area > 250 and near(civic_tree, g, 15): use, fl = 'civic', 3           # hospitals, clinics, colleges
    elif area < 160 and near(main_tree, g, 7): use, fl = 'shop', 1               # shop rows face the main streets
    hm = [0, 3.6, 6.8, 10][fl]; kind = 'house'
    if area > 120 and any(m.distance(g) * mx < 4 for m in mosq): kind = 'mosque'; hm = 7.5; use = 'mosque'
    # tone: one of six real roof finishes (plaster, yellow brick, cream…), stable per building
    lit = 1 if kind == 'house' and use == 'home' and (h >> 14) % 10 < 3 else None   # about 3 homes in 10 have lights on at night
    add('buildings', g, {'hm': hm, 'base': 0, 'kind': kind, 'use': use, 'tone': h % 6, 'lit': lit}, 14); nb += 1
    if lit: add('lights', g.representative_point(), {}, 15)
    if kind != 'house' or use in ('school', 'civic'): continue
    # rooftop life, only when the town is close (z15+ tiles): a water tank on about a third of the roofs, the stair hut
    # (بيت الدرج) on most houses (every roof is used: sleeping in summer, washing, the tank), and a satellite dish on some
    c = g.representative_point(); cx, cy = c.x, c.y
    if 40 < area < 600 and h % 20 < 7:
        s = 0.4 + ((h >> 8) % 5) * 0.1
        t = box((cx, cy), s, s)
        if g.contains(t): add('buildings', t, {'hm': hm + 1.5, 'base': hm, 'kind': 'tankW' if h % 2 else 'tankB'}, 15); nr += 1
    if 60 < area < 500 and (h >> 4) % 10 < (8 if fl >= 2 else 6):
        # work in metres: a 2.6 m square turned to the house's own walls, centred on a corner of the roof pulled
        # 2.5 m inwards, so it always sits inside the parapet whatever way the street runs
        gm = shapely.affinity.scale(g, mx, my, origin=(0, 0))
        inner = gm.buffer(-2.5, join_style='mitre')
        if not inner.is_empty and inner.geom_type == 'Polygon':
            rr = list(gm.minimum_rotated_rectangle.exterior.coords)
            ang = math.degrees(math.atan2(rr[1][1] - rr[0][1], rr[1][0] - rr[0][0]))
            pts = list(inner.exterior.coords)[:-1]; vx, vy = pts[(h >> 6) % len(pts)]
            t = shapely.affinity.rotate(sg.box(vx - 1.3, vy - 1.3, vx + 1.3, vy + 1.3), ang, origin=(vx, vy))
            if gm.contains(t): add('buildings', shapely.affinity.scale(t, 1 / mx, 1 / my, origin=(0, 0)), {'hm': hm + 2.4, 'base': hm, 'kind': 'hut'}, 15); nr += 1
    if fl >= 1 and 50 < area < 600 and (h >> 10) % 10 < 3:
        t = box((cx + 2.2 / mx * ((h >> 12) % 3 - 1), cy + 2.2 / my), 0.35, 0.35)
        if g.contains(t): add('buildings', t, {'hm': hm + 0.9, 'base': hm, 'kind': 'dish'}, 15); nr += 1
print('buildings', nb, 'roof pieces', nr, file=sys.stderr)

# street lamps and palms (map audit, 2026-10-12): a lamp post every ~26 m along both sides of the main streets across
# town (one side, alternating, on the mid streets outside the centre), and a date palm on the pavement between every
# second pair of posts on the main streets. Pieces are small boxes in the air like the lanterns, in the same layer:
# `post` (pole, foot and arm), `head` (the lamp: cream by day, lit at night), `trunk`, `frond`, `crown`, `pit`, and a
# `lampglow` point 3 m into the street for the night pool of light.
# lantern strings (Ali, 2026-10-11: the Ramadan streets, kept all year): in the town centre a string of fanous
# lanterns hangs across the street between each pair of posts, sagging in the middle. Each lantern is a small box in the
# air (base/hm) with a colour index `c` (0 saffron, 1 gold, 2 coral) the style colours by light: painted glass by day,
# lit at night. A `glow` point under each string lets the night style pool warm light on the street. Only close up
# (z16 tiles).
LANTERN_CORE_M, LANTERN_EVERY_M, LANTERN_GAP_M = 1700, 26, 2.2
LANTERN_HALF = {'major': 9.0, 'mid': 6.5}
LAMP_TOWN_M, POST_H = 3200, 7.2
lan_mids = []; nstr = nlan = npost = npalm = 0
cxm, cym = CENTER[0] * mx, CENTER[1] * my
to_deg = lambda q: shapely.affinity.scale(q, 1 / mx, 1 / my, origin=(0, 0))
sq = lambda x, y, h: sg.box(x - h, y - h, x + h, y + h)
ngon = lambda x, y, r, n: sg.Polygon([(x + r * math.cos(2 * math.pi * i / n), y + r * math.sin(2 * math.pi * i / n)) for i in range(n)])
# what a post or palm must keep clear of: every other street (crossings) and the houses (pavements in Overture are thin)
street_m = [(i, shapely.affinity.scale(g, mx, my, origin=(0, 0))) for i, (ly, g, p, *_ ) in enumerate(F) if ly == 'roads' and p.get('cls') in ('major', 'mid', 'minor', 'alley', 'highway')]
street_tree = STRtree([g for _, g in street_m]); street_ids = [i for i, _ in street_m]
house_tree = STRtree([shapely.affinity.scale(g, mx, my, origin=(0, 0)) for (ly, g, p, *_ ) in F if ly == 'buildings' and p.get('kind') in ('house', 'mosque')])
def clear(x, y, own, r):
    pt = sg.Point(x, y)
    if any(street_ids[j] != own for j in street_tree.query(pt, predicate='dwithin', distance=r)): return False
    return len(house_tree.query(pt, predicate='dwithin', distance=0.4)) == 0
posts = []
def lamp_post(x, y, nx, ny):
    """A post at (x, y) metres with its arm reaching 1.4 m over the street along (nx, ny)."""
    global npost
    if any(abs(x - o[0]) < 7 and abs(y - o[1]) < 7 for o in posts): return False
    posts.append((x, y)); npost += 1
    hx, hy = x + nx * 1.4, y + ny * 1.4
    for q, base, top, kind in ((sq(x, y, 0.15), 0, POST_H, 'post'), (sq(x, y, 0.25), 0, 0.7, 'post'),
                               (sq((x + hx) / 2, (y + hy) / 2, 0.75), POST_H - 0.15, POST_H, 'post'), (sq(hx, hy, 0.32), POST_H - 0.35, POST_H - 0.05, 'head')):
        add('lanterns', to_deg(q), {'kind': kind, 'base': base, 'hm': top}, 16)
    add('lanterns', sg.Point((x + nx * 3) / mx, (y + ny * 3) / my), {'kind': 'lampglow'}, 16)
    return True
def palm(x, y):
    global npalm
    npalm += 1
    parts = [(ngon(x, y, 0.6, 8), 0, 0.35, 'pit'), (ngon(x, y, 0.22, 6), 0, 7.5, 'trunk')]
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.3
        parts.append((ngon(x + math.cos(a) * 1.6, y + math.sin(a) * 1.6, 1.05, 6), 6.9 - (k % 2) * 0.5, 7.3 - (k % 2) * 0.5, 'frond'))
    parts.append((ngon(x, y, 0.9, 8), 7.3, 8.0, 'crown'))
    for q, base, top, kind in parts: add('lanterns', to_deg(q), {'kind': kind, 'base': base, 'hm': top}, 16)
for fi, (ly, g, p, z0, z1) in enumerate(list(F)):
    if ly != 'roads' or p.get('cls') not in LANTERN_HALF or z0 < 12: continue
    gm = shapely.affinity.scale(g, mx, my, origin=(0, 0))
    if gm.geom_type != 'LineString' or gm.length < 40: continue
    half = LANTERN_HALF[p['cls']]
    d = 14.0
    while d < gm.length - 14:
        c = gm.interpolate(d); a = gm.interpolate(d - 2); b = gm.interpolate(d + 2); d += LANTERN_EVERY_M
        r = math.hypot(c.x - cxm, c.y - cym)
        if r > LAMP_TOWN_M: continue
        if any(abs(c.x - o[0]) < 16 and abs(c.y - o[1]) < 16 for o in lan_mids): continue   # dual carriageways, crossings
        lan_mids.append((c.x, c.y))
        ux, uy = b.x - a.x, b.y - a.y; L_ = math.hypot(ux, uy) or 1; ux, uy = ux / L_, uy / L_; nx, ny = -uy, ux   # across the street
        k = len(lan_mids)
        core = r <= LANTERN_CORE_M
        off = half + 0.6
        sides = (-1, 1) if p['cls'] == 'major' or core else ((-1,) if k % 2 else (1,))
        for sd in sides:
            x, y = c.x + nx * off * sd, c.y + ny * off * sd
            if clear(x, y, fi, 3): lamp_post(x, y, -nx * sd, -ny * sd)
        if p['cls'] == 'major' and k % 2 == 0 and d - LANTERN_EVERY_M / 2 < gm.length - 8:
            m = gm.interpolate(d - LANTERN_EVERY_M / 2)   # half way to the next pair of posts
            for sd in (-1, 1):
                x, y = m.x + nx * (off + 0.4) * sd, m.y + ny * (off + 0.4) * sd
                if clear(x, y, fi, 4): palm(x, y)
        if not core: continue
        n = int(2 * half // LANTERN_GAP_M)
        for i in range(n + 1):
            t = i / n; o = -half + 2 * half * t
            z = 6.4 - 1.5 * (1 - (2 * t - 1) ** 2)                                              # the string sags in the middle
            q = sg.box(c.x + nx * o - 0.45, c.y + ny * o - 0.45, c.x + nx * o + 0.45, c.y + ny * o + 0.45)
            add('lanterns', to_deg(q), {'kind': 'lamp', 'c': (i + k) % 3, 'base': round(z - 0.9, 2), 'hm': round(z, 2)}, 16)
            nlan += 1
        add('lanterns', sg.Point(c.x / mx, c.y / my), {'kind': 'glow'}, 16); nstr += 1
print('lantern strings', nstr, 'lanterns', nlan, 'lamp posts', npost, 'palms', npalm, file=sys.stderr)

# fields and the edge of town (map audit, 2026-10-12), within FIELDS_M of the centre:
# - the farmland in long plots from z13 (landuse kind `plot`, `crop` 0 wheat … 4 ploughed), turned to each farm's own lie and
#   kept out of town, with a narrow path between plots where the farm colour shows through;
# - date palm clumps and dusty worn ground on the empty land between the houses at the edge of town (palm pieces in the
#   `lanterns` layer with the street palms; `dust` patches in landuse, `d` 0–2).
FIELDS_M, PLOT_W, PLOT_L = 4500, 60, 220
_rf = _rnd.Random(11)
near_c = sg.Point(cxm, cym).buffer(FIELDS_M)
houses_m = [shapely.affinity.scale(g, mx, my, origin=(0, 0)) for (ly, g, p, *_ ) in F if ly == 'buildings' and p.get('kind') in ('house', 'mosque')]
houses_m = [h for h in houses_m if near_c.intersects(h)]
town_m = shapely.union_all([h.buffer(45, quad_segs=2) for h in houses_m]).buffer(-20)
nplot = 0
for ly, g, p, *_ in list(F):
    if ly != 'landuse' or p.get('kind') != 'farm2': continue
    gm = shapely.affinity.scale(g, mx, my, origin=(0, 0)).buffer(0).intersection(near_c).difference(town_m)
    if gm.is_empty or gm.area < 4000: continue
    rr = list(gm.minimum_rotated_rectangle.exterior.coords)
    ang = math.degrees(math.atan2(rr[1][1] - rr[0][1], rr[1][0] - rr[0][0])); ctr = gm.centroid
    rot = shapely.affinity.rotate(gm, -ang, origin=ctr)
    x0, y0, x1, y1 = rot.bounds; yy = y0; row = 0
    while yy < y1:
        xx = x0 + (row % 2) * 20
        while xx < x1:
            w = PLOT_W * (0.7 + _rf.randrange(7) / 10)
            part = sg.box(xx, yy, xx + w, yy + PLOT_L).intersection(rot)
            if not part.is_empty and part.area > 300:
                q = shapely.affinity.rotate(part, ang, origin=ctr).buffer(-1.2, join_style='mitre')
                if not q.is_empty:
                    k = _rf.randrange(10)
                    add('landuse', shapely.affinity.scale(q, 1 / mx, 1 / my, origin=(0, 0)), {'kind': 'plot', 'crop': 0 if k < 3 else 1 if k < 5 else 2 if k < 7 else 3 if k < 9 else 4}, 13)
                    nplot += 1
            xx += w
        yy += PLOT_L; row += 1
water_tree = STRtree([shapely.affinity.scale(g, mx, my, origin=(0, 0)) for (ly, g, p, *_ ) in F if ly == 'water' and p.get('kind') == 'river'])
house_tree_m = STRtree(houses_m)
EDGE_M, CELL = 3200, 56
nclump = nedge = ndust = 0
for gx in range(int(cxm - EDGE_M), int(cxm + EDGE_M), CELL):
    for gy in range(int(cym - EDGE_M), int(cym + EDGE_M), CELL):
        x, y = gx + _rf.uniform(0, CELL), gy + _rf.uniform(0, CELL)
        if math.hypot(x - cxm, y - cym) > EDGE_M: continue
        c = sg.Point(x, y)
        if len(house_tree_m.query(c, predicate='dwithin', distance=18)) or not len(house_tree_m.query(c, predicate='dwithin', distance=160)): continue
        if len(street_tree.query(c, predicate='dwithin', distance=10)) or len(water_tree.query(c, predicate='dwithin', distance=15)): continue
        k = _rf.random()
        if k < 0.25:
            add('landuse', to_deg(c.buffer(_rf.uniform(12, 26), quad_segs=4)), {'kind': 'dust', 'd': _rf.randrange(3)}, 14); ndust += 1
        if k > 0.35:
            nclump += 1
            for _ in range(_rf.randint(2, 5)):
                px, py = x + _rf.uniform(-12, 12), y + _rf.uniform(-12, 12)
                if len(house_tree_m.query(sg.Point(px, py), predicate='dwithin', distance=4)): continue
                ht = _rf.uniform(6, 10); nedge += 1
                # two pieces a palm (a trunk and a star of fronds as one shape), so the groves stay light in the tiles
                add('lanterns', to_deg(ngon(px, py, 0.25, 5)), {'kind': 'trunk', 'base': 0, 'hm': round(ht, 1)}, 16)
                spin = _rf.random() * math.pi
                star = sg.Polygon([(px + math.cos(spin + i * math.pi / 5) * (2.6 if i % 2 == 0 else 0.9), py + math.sin(spin + i * math.pi / 5) * (2.6 if i % 2 == 0 else 0.9)) for i in range(10)])
                add('lanterns', to_deg(star), {'kind': 'frond', 'base': round(ht - 0.5, 1), 'hm': round(ht + 0.1, 1)}, 16)
print('field plots', nplot, 'edge palm clumps', nclump, 'palms', nedge, 'dust', ndust, file=sys.stderr)

# places (POIs) -----------------------------------------------------------------------
# Signposts (Ali, 2026-10-12): the places people give directions by carry `icon`, which the style draws as a standing
# pin. Our own list (data/our-places.json, exported from the names-and-places page Ali fills in; not in the repo)
# wins: when it is there, it names the neighbourhoods and its places replace the open-data ones of the same kind.
def sign_kind(cat, n):
    if any(k in n for k in ('جامع', 'مسجد', 'حسينية')) or 'worship' in cat: return 'mosque'
    if 'صيدلية' in n or 'pharmacy' in cat: return 'pharmacy'
    if any(k in n for k in ('فرن', 'مخبز', 'صمون')) or 'bakery' in cat: return 'bakery'
    if cat in ('hospital', 'health_care', 'specialized_medical_facility', 'outpatient_care_facility') or any(k in n for k in ('مستشفى', 'مستوصف', 'مركز صحي')): return 'health'
    if cat in ('place_of_learning', 'education', 'elementary_school', 'college_university') or any(k in n for k in ('مدرسة', 'ثانوية', 'متوسطة', 'كلية')): return 'school'
    if cat == 'gas_station' or 'محطة وقود' in n or 'بانزين' in n: return 'fuel'
    return None
SIGN_RANK = {'mosque': 1, 'health': 1, 'fuel': 1, 'school': 2, 'pharmacy': 2, 'bakery': 2}
ours_path = os.path.join(TOWN, 'our-places.json')
ours = json.load(open(ours_path)) if os.path.exists(ours_path) else []
our_kinds = {o['kind'] for o in ours if o.get('kind') != 'area'}
for f in pois:
    p = f['properties']; n = nm(p)
    if not n: continue
    conf = p.get('confidence') or 0
    icon = sign_kind(p.get('basic_category') or '', n)
    if icon in our_kinds: continue
    props = {'name': n, 'kind': p.get('basic_category') or 'other', 'rank': 1 if conf > 0.8 else 2 if conf > 0.5 else 3}
    if icon: props.update(icon=icon, rank=SIGN_RANK[icon])
    add('places', sg.shape(f['geometry']), props, 14 if conf > 0.5 or icon else 15)
for o in ours:
    if not isinstance(o.get('lng'), (int, float)) or not o.get('name'): continue
    n = o['name'].translate(WESTERN_DIGITS); g = sg.Point(o['lng'], o['lat'])
    if o['kind'] == 'area': add('localities', g, {'name': n, 'kind': 'area', 'rank': 6}, 13)
    elif o['kind'] in SIGN_RANK: add('places', g, {'name': n, 'kind': o['kind'], 'icon': o['kind'], 'rank': SIGN_RANK[o['kind']]}, 14)
print('places: ours', len(ours), 'signposts', sum(1 for x in F if x[0] == 'places' and 'icon' in x[2]), file=sys.stderr)

# localities + neighbourhoods (divisions) ----------------------------------------------
LOC = {'city': (1, 7), 'town': (2, 8), 'village': (3, 11), 'hamlet': (4, 12)}
NB = {'macrohood': (5, 11), 'neighborhood': (6, 13), 'microhood': (7, 14)}
for f in L(WIDE, 'w_division'):
    p = f['properties']; st = p['subtype']; n = nm(p)
    if not n or f['geometry']['type'] != 'Point': continue
    if st == 'locality':
        r, z0 = LOC.get(p.get('class') or 'village', (3, 11))
        add('localities', sg.shape(f['geometry']), {'name': n, 'kind': p.get('class') or 'village', 'rank': r, 'pop': p.get('population')}, z0)
    elif st in NB:
        r, z0 = NB[st]
        add('localities', sg.shape(f['geometry']), {'name': n, 'kind': st, 'rank': r, 'pop': p.get('population')}, z0)

print('features', len(F), 'buildings', nb, flush=True)

# ---------------- tiling ----------------
def merc(xy):
    x = (xy[:, 0] + 180) / 360
    lat = np.radians(np.clip(xy[:, 1], -85, 85))
    y = (1 - np.log(np.tan(lat) + 1 / np.cos(lat)) / math.pi) / 2
    return np.column_stack([x, y])
geoms_m = shapely.transform(np.array([f[1] for f in F], dtype=object), merc)
LAYERS = ['landuse', 'palms', 'water', 'roads', 'buildings', 'landmarks', 'lights', 'lanterns', 'places', 'localities']
LAYER_TYPES = {}
lon2x = lambda lon: (lon + 180) / 360
lat2y = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2

tiles = {}; t0 = time.time()
for z in range(MINZ, MAXZ + 1):
    n = 2 ** z; k = n * EXT
    idx = [i for i, f in enumerate(F) if f[3] <= z <= f[4]]
    gs = shapely.transform(geoms_m[idx], lambda c: c * k)
    tol = 0.5 if z == MAXZ else 2.0   # tile units (4096/tile, 512 css px) -> <=0.25 css px
    simp = []
    for g, i in zip(gs, idx):
        lay = F[i][0]
        if g.geom_type in ('Point', 'MultiPoint'): simp.append(g); continue
        s = shapely.simplify(g, tol, preserve_topology=(lay in ('buildings', 'landmarks', 'lanterns')))
        if lay in ('landuse', 'palms', 'water') and s.geom_type in ('Polygon', 'MultiPolygon') and s.area < 64: s = None
        simp.append(s)
    keep = [j for j, s in enumerate(simp) if s is not None and not s.is_empty]
    gs = [simp[j] for j in keep]; idx = [idx[j] for j in keep]
    tree = STRtree(gs)
    x0, x1 = int(lon2x(REGION[0]) * n), int(lon2x(REGION[2]) * n)
    y0, y1 = int(lat2y(REGION[3]) * n), int(lat2y(REGION[1]) * n)
    cnt = 0
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            ox, oy = tx * EXT, ty * EXT
            clip = sg.box(ox - BUF, oy - BUF, ox + EXT + BUF, oy + EXT + BUF)
            hits = tree.query(clip, predicate='intersects')
            if len(hits) == 0: continue
            layers = {}
            for j in sorted(hits):
                g = gs[j]; lay, _, props, _, _ = F[idx[j]]
                if g.geom_type != 'Point':
                    if not clip.contains(g): g = g.intersection(clip)
                    if g.is_empty: continue
                    if g.geom_type == 'GeometryCollection':
                        want = 'LineString' if lay in ('roads',) or (lay == 'water' and props['kind'] not in ('river', 'depth')) else 'Polygon'
                        parts = [q for q in g.geoms if want in q.geom_type]
                        if not parts: continue
                        g = shapely.union_all(parts) if len(parts) > 1 else parts[0]
                    if lay in ('roads',) or (lay == 'water' and props['kind'] not in ('river', 'depth', 'reed')):
                        if 'Polygon' in g.geom_type or 'Point' in g.geom_type: continue
                g = shapely.transform(g, lambda c: c - np.array([ox, oy]))
                layers.setdefault(lay, []).append({'geometry': g.wkt, 'properties': props})
            if not layers: continue
            data = mvt.encode([{'name': l, 'features': layers[l]} for l in LAYERS if l in layers],
                              default_options={'extents': EXT, 'y_coord_down': True})
            tiles[zxy_to_tileid(z, tx, ty)] = gzip.compress(data, 9, mtime=0)
            for l in layers: LAYER_TYPES.setdefault(l, set()).add(z)
            cnt += 1
    print(f'z{z}: {len(idx)} feats, {cnt} tiles, {sum(len(tiles[t]) for t in tiles if True)/1e6:.2f} MB cum, {time.time()-t0:.0f}s', flush=True)

out = os.path.join(OUT, 'wasit.pmtiles')
with open(out, 'wb') as fh:
    w = Writer(fh)
    for tid in sorted(tiles): w.write_tile(tid, tiles[tid])
    e7 = lambda v: int(v * 1e7)
    w.finalize({'tile_type': TileType.MVT, 'tile_compression': Compression.GZIP, 'min_zoom': MINZ, 'max_zoom': MAXZ,
                'min_lon_e7': e7(REGION[0]), 'min_lat_e7': e7(REGION[1]), 'max_lon_e7': e7(REGION[2]), 'max_lat_e7': e7(REGION[3]),
                'center_zoom': 13, 'center_lon_e7': e7(CENTER[0]), 'center_lat_e7': e7(CENTER[1])},
               {'name': f'Wasit (Aziziyah) — Overture {RELEASE}', 'format': 'pbf',
                'attribution': '© OpenStreetMap contributors, Overture Maps Foundation',
                'vector_layers': [{'id': l, 'fields': {}, 'minzoom': min(LAYER_TYPES[l]), 'maxzoom': max(LAYER_TYPES[l])} for l in LAYERS if l in LAYER_TYPES]})
print('wrote', out, os.path.getsize(out), 'bytes')

# ---------------- labels.json (glyph-free label data) ----------------
def bearing(a, b):
    dx = (b[0] - a[0]) * math.cos(math.radians(a[1])); dy = b[1] - a[1]
    return round((math.degrees(math.atan2(dx, dy)) + 360) % 360, 1)
def point_and_bearing(line):
    L_ = line.length; p = line.interpolate(0.5, normalized=True)
    a = line.interpolate(max(0, L_ * 0.5 - L_ * 0.02)); b = line.interpolate(min(L_, L_ * 0.5 + L_ * 0.02))
    return [round(p.x, 6), round(p.y, 6)], bearing((a.x, a.y), (b.x, b.y))
def km(line): return line.length * mx / 1000
def best_lines(groups, min_km, max_per):
    out = []
    for name, lines in groups.items():
        m = linemerge(lines)
        parts = list(m.geoms) if m.geom_type == 'MultiLineString' else [m]
        parts = sorted([q for q in parts if km(q) >= min_km], key=lambda q: -q.length)
        done = []
        for q in parts:
            if len(done) >= max_per: break
            at, br = point_and_bearing(q)
            # dual carriageways: skip a part whose label point is within 150 m of one already taken
            if any(math.hypot((at[0] - a[0]) * mx, (at[1] - a[1]) * my) < max(150, 50 * km(q)) for a in done): continue
            done.append(at); out.append({'name': name, 'at': at, 'bearing': round(br % 180, 1), 'km': round(km(q), 2)})
    return out
streets = {}; scls = {}
for f in town_seg:
    p = f['properties']; n = nm(p); c = CLS.get(p.get('class'))
    if not n or not AR.search(n) or c not in ('highway', 'major', 'mid', 'minor'): continue
    g = sg.shape(f['geometry'])
    if not (TOWNBOX[0] < g.centroid.x < TOWNBOX[2] and TOWNBOX[1] < g.centroid.y < TOWNBOX[3]): continue
    streets.setdefault(n, []).append(g); scls[n] = min(scls.get(n, 'z'), c)
st_labels = best_lines(streets, 0.15, 3)
for s in st_labels: s['cls'] = scls[s['name']]
rivers = {}
for n, g in river_lines:
    if n and AR.search(n): rivers.setdefault(n, []).extend(list(g.geoms) if g.geom_type == 'MultiLineString' else [g])
riv = []
for n, lines in rivers.items():
    m = linemerge(lines); parts = list(m.geoms) if m.geom_type == 'MultiLineString' else [m]
    for q in parts:
        L_km = km(q); steps = max(1, int(L_km // 12))  # one label every ~12 km
        for i in range(steps):
            t = (i + 0.5) / steps; p = q.interpolate(t, normalized=True)
            a = q.interpolate(max(0, t - 0.01), normalized=True); b = q.interpolate(min(1, t + 0.01), normalized=True)
            if L_km >= 1: riv.append({'name': n, 'at': [round(p.x, 6), round(p.y, 6)], 'bearing': bearing((a.x, a.y), (b.x, b.y)), 'km': round(L_km, 1)})
locs = [];  nbh = []
for lay, g, props, z0, _ in F:
    if lay != 'localities': continue
    rec = {'name': props['name'], 'kind': props['kind'], 'at': [round(g.x, 6), round(g.y, 6)], 'minzoom': z0}
    if props.get('pop'): rec['pop'] = props['pop']
    (locs if props['rank'] <= 4 else nbh).append(rec)
pls = [{'name': props['name'], 'category': props['kind'], 'at': [round(g.x, 6), round(g.y, 6)], 'rank': props['rank']}
       for lay, g, props, _, _ in F if lay == 'places']
labels = {'source': 'Overture Maps 2026-09-23.0', 'bbox_region': REGION, 'bbox_town': TOWNBOX,
          'streets': sorted(st_labels, key=lambda s: (s['cls'], -s['km'])),
          'places': sorted(pls, key=lambda s: s['rank']),
          'localities': sorted(locs, key=lambda s: (s['minzoom'], -(s.get('pop') or 0))),
          'neighbourhoods': nbh, 'rivers': riv}
json.dump(labels, open(os.path.join(OUT, 'labels.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('labels', {k: len(v) for k, v in labels.items() if isinstance(v, list)}, os.path.getsize(os.path.join(OUT, 'labels.json')))
