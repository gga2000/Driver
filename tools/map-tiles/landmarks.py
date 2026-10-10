# Landmarks in 3D: the main mosque, the hospital and the intercity garages (Ali, 2026-10-09: "not real spot, make a
# good looking design for each"). Each model is drawn in metres around its site, the front facing the main road it
# sits on, and comes out as small extruded parts, each with a `part` the style colours by light.
#
# Sites are design spots, not surveyed ones: an empty lot beside a main road, off the river, near where the place is
# believed to be (picked with the buildings and water data). Move them when field ops pins the real ones.
import math
import shapely, shapely.affinity as af, shapely.geometry as sg

SITES = {
    # key: (lng, lat of the lot centre, road angle in degrees, side of the road), sizes are the model's own
    'mosque': (45.05873, 32.90695, -112, 1),
    'hospital': (45.06723, 32.90885, -37, 1),
    'garage_bab1': (45.05884, 32.90508, 68, 1),
    'garage_bab2': (45.06523, 32.90977, -24, 1),
    'garage_souq': (45.05680, 32.90570, 157, 1),
}


def _disc(x, y, r, n=16):
    return sg.Point(x, y).buffer(r, quad_segs=max(2, n // 4))


def _box(x0, y0, x1, y1):
    return sg.box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


class Model:
    """Parts in a local frame: x along the road, y away from it (front edge at y = -depth/2)."""

    def __init__(self):
        self.parts = []

    def add(self, g, part, base, top):
        if g is not None and not g.is_empty:
            self.parts.append((g, part, round(base, 2), round(top, 2)))

    def dome(self, x, y, r, base, part, slices=7, finial=None):
        # a hemisphere as stacked rings: wide and low first, narrow and high last
        for i in range(slices):
            a0, a1 = math.pi / 2 * i / slices, math.pi / 2 * (i + 1) / slices
            self.add(_disc(x, y, r * math.cos(a0 + (a1 - a0) * 0.35), 24), part, base + r * math.sin(a0), base + r * math.sin(a1))
        if finial:
            self.add(_disc(x, y, 0.35, 8), finial, base + r, base + r + 2.6)
            self.add(_disc(x, y, 0.7, 8), finial, base + r + 1.6, base + r + 2.0)

    def palm(self, x, y, h=7.5):
        self.add(_disc(x, y, 0.28, 8), 'trunk', 0, h)
        self.add(_disc(x, y, 2.3, 12), 'crown', h - 0.4, h + 0.5)
        self.add(_disc(x, y, 1.3, 10), 'crown', h + 0.5, h + 1.1)

    def person(self, x, y, part='person'):
        self.add(_disc(x, y, 0.42, 8), part, 0, 1.5)
        self.add(_disc(x, y, 0.26, 8), 'skin', 1.5, 1.95)

    def vehicle(self, x, y, length, width, part, h=2.3, along=True, stripe=None):
        b = _box(x - length / 2, y - width / 2, x + length / 2, y + width / 2) if along else _box(x - width / 2, y - length / 2, x + width / 2, y + length / 2)
        self.add(b, part, 0.3, h)
        if stripe:
            self.add(b.buffer(0.05, join_style='mitre'), stripe, 1.1, 1.4)
        self.add(b.buffer(-0.25, join_style='mitre'), 'glass', h - 0.05, h + 0.02)


def mosque():
    m = Model()
    W, D = 60, 68
    # compound wall with a gate in the middle of the front
    outer = _box(-W / 2, -D / 2, W / 2, D / 2)
    wall = outer.difference(outer.buffer(-0.7, join_style='mitre')).difference(_box(-5, -D / 2 - 1, 5, -D / 2 + 2))
    m.add(outer.buffer(-0.7, join_style='mitre'), 'pave', 0, 0.12)
    m.add(wall, 'stone', 0, 3.4)
    m.add(_box(-6.5, -D / 2 - 0.6, -5, -D / 2 + 1.4), 'stone', 0, 6)   # gate piers
    m.add(_box(5, -D / 2 - 0.6, 6.5, -D / 2 + 1.4), 'stone', 0, 6)
    m.add(_box(-6.5, -D / 2 - 0.6, 6.5, -D / 2 + 1.4), 'trim', 5.2, 6.4)
    # prayer hall at the back, its portico facing the courtyard
    hy0, hy1 = 2, D / 2 - 3
    m.add(_box(-20, hy0, 20, hy1), 'stone', 0, 11)
    m.add(_box(-20.4, hy0 - 0.4, 20.4, hy1 + 0.4), 'trim', 10.6, 11.6)          # cornice
    m.add(_box(-20, hy0 - 6, 20, hy0), 'stone', 0, 7)                            # portico
    m.add(_box(-20.3, hy0 - 6.3, 20.3, hy0), 'trim', 6.6, 7.4)
    for i in range(-4, 5):                                                       # arches read as dark bays
        if i: m.add(_box(i * 4.2 - 1.3, hy0 - 6.05, i * 4.2 + 1.3, hy0 - 5.9), 'shade', 0, 5.2)
    m.add(_box(-6, hy0 - 7.5, 6, hy0 + 1), 'stone', 0, 15)                        # the iwan, the tall gate of the hall
    m.add(_box(-6.3, hy0 - 7.8, 6.3, hy0 + 1), 'trim', 15, 15.8)
    for i, half in enumerate((4.2, 2.6, 1.2)):                                     # its crown steps up to a point
        m.add(_box(-half, hy0 - 7.5, half, hy0 - 5.5), 'stone', 15.8 + i * 0.9, 16.7 + i * 0.9)
    m.add(_box(-3.8, hy0 - 7.85, 3.8, hy0 - 7.5), 'gold', 0, 12.4)               # gold-tiled frame round the arch
    for i, half in enumerate((3.2, 2.4, 1.4)):                                     # the arch itself, pointed at the top
        m.add(_box(-half, hy0 - 7.95, half, hy0 - 7.7), 'shade', 0 if i == 0 else 10 + (i - 1) * 0.8, 10 + i * 0.8)
    # the dome on its drum, and four small ones at the corners
    cy = (hy0 + hy1) / 2 + 1
    m.add(_disc(0, cy, 10, 32), 'stone', 11, 14.5)
    m.add(_disc(0, cy, 10.3, 32), 'trim', 14.1, 14.9)
    m.dome(0, cy, 9.6, 14.9, 'dome', slices=14, finial='gold')
    for sx in (-15, 15):
        for sy in (hy0 + 4, hy1 - 4):
            m.add(_disc(sx, sy, 2.8, 16), 'stone', 11, 12)
            m.dome(sx, sy, 2.6, 12, 'dome', slices=6)
    # two minarets at the front corners of the hall
    for sx in (-23.5, 23.5):
        y = hy0 - 3
        m.add(_box(sx - 2.4, y - 2.4, sx + 2.4, y + 2.4), 'stone', 0, 9)
        m.add(_disc(sx, y, 1.7, 8), 'brick', 9, 28)
        for z in (14, 20):
            m.add(_disc(sx, y, 1.8, 8), 'trim', z, z + 0.5)
        m.add(_disc(sx, y, 2.6, 12), 'trim', 28, 29.2)                           # the call balcony
        m.add(_disc(sx, y, 1.3, 8), 'brick', 29.2, 35)
        m.add(_disc(sx, y, 1.6, 8), 'trim', 35, 35.6)
        for i, r in enumerate((1.3, 1.0, 0.7, 0.4)):
            m.add(_disc(sx, y, r, 8), 'gold', 35.6 + i * 1.1, 36.7 + i * 1.1)
        m.add(_disc(sx, y, 0.15, 6), 'gold', 40, 42)
    # the courtyard: a fountain and palms along the sides
    m.add(_disc(0, -16, 3.2, 16), 'trim', 0, 0.6)
    m.add(_disc(0, -16, 2.5, 16), 'water', 0.5, 0.65)
    for x in (-24, -14, 14, 24):
        for y in (-26, -14):
            m.palm(x, y)
    for x, y in ((-3, -27), (2.5, -23), (7, -19), (-8, -12), (-2.2, -8.5)):
        m.person(x, y, 'robe')
    return m


def hospital():
    m = Model()
    W, D = 94, 62
    outer = _box(-W / 2, -D / 2, W / 2, D / 2)
    m.add(outer.buffer(-0.5, join_style='mitre'), 'pave', 0, 0.1)
    fence = outer.difference(outer.buffer(-0.5, join_style='mitre')).difference(_box(-8, -D / 2 - 1, 8, -D / 2 + 2))
    m.add(fence, 'stone', 0, 2.2)
    # the main block across the back and a wing towards the road (an L), with floor bands
    blocks = [_box(-38, 6, 38, 24), _box(22, -14, 38, 6)]
    for b in blocks:
        m.add(b, 'white', 0, 14)
        for z in (4.2, 8.2, 12.2):
            m.add(b.buffer(0.15, join_style='mitre'), 'band', z, z + 0.9)
        m.add(b.buffer(0.3, join_style='mitre'), 'trim', 13.8, 14.6)
    m.add(_box(-30, 12, -18, 20), 'white', 14, 17)                # plant room and lift tower
    for x in (-12, -6, 0, 6):
        m.add(_disc(x, 18, 1.0, 8), 'tank', 14, 15.6)
    # the red crescent on a white roof disc, seen from the sky
    cres = _disc(14, 15, 5.5, 32).difference(_disc(16.2, 15.8, 4.6, 32))
    m.add(_disc(14.6, 15, 7.2, 32), 'white', 14, 14.75)
    m.add(cres, 'red', 14.75, 14.9)
    # the entrance: a deep canopy on posts, a red sign above it
    m.add(_box(-12, -1, 12, 6), 'trim', 4.2, 4.9)
    for x in (-11, -3.7, 3.7, 11):
        m.add(_box(x - 0.3, -0.7, x + 0.3, -0.1), 'steel', 0, 4.2)
    m.add(_box(-7, 5.6, 7, 6.2), 'red', 5.2, 8.4)
    # ambulances under the canopy, cars in the parking, palms along the fence
    m.vehicle(-6, 2.5, 5.8, 2.2, 'white', h=2.6, stripe='red')
    m.vehicle(1, 2.5, 5.8, 2.2, 'white', h=2.6, stripe='red')
    for i, x in enumerate(range(-40, -14, 4)):
        m.vehicle(x, -20, 4.5, 1.8, 'car' if i % 3 else 'car2', h=1.5, along=False)
    for x in range(-40, 44, 10):
        m.palm(x, -D / 2 + 3)
    for x, y in ((-2, -3), (2, -5), (8.5, -2.5), (-9, -6)):
        m.person(x, y)
    return m


def garage(seed=0):
    m = Model()
    W, D = 80, 48
    outer = _box(-W / 2, -D / 2, W / 2, D / 2)
    m.add(outer, 'yard', 0, 0.08)
    # a low wall round three sides, the road side open
    back = outer.difference(outer.buffer(-0.5, join_style='mitre')).difference(_box(-W / 2 + 0.6, -D / 2 - 1, W / 2 - 0.6, -D / 2 + 0.6))
    m.add(back, 'stone', 0, 2)
    # the gate frame at the front with its sign board
    for x in (-14, 14):
        m.add(_box(x - 0.8, -D / 2 - 0.8, x + 0.8, -D / 2 + 0.8), 'steel', 0, 7.5)
    m.add(_box(-14.8, -D / 2 - 0.4, 14.8, -D / 2 + 0.4), 'steel', 6.6, 7.5)
    m.add(_box(-9, -D / 2 - 0.5, 9, -D / 2 + 0.5), 'sign', 7.5, 9.6)
    # the long steel canopy over the bays, posts every 9 m, and minibuses lined under it
    for row, y in enumerate((4, 16)):
        for k in range(8):                                                       # corrugated sheets with gaps of light
            m.add(_box(-34, y - 5 + k * 1.28, 34, y - 5 + k * 1.28 + 0.9), 'canopy', 5.0, 5.4)
        m.add(_box(-34.2, y - 5.2, 34.2, y - 4.6), 'steel', 4.7, 5.5)
        for x in range(-33, 34, 11):
            m.add(_box(x - 0.25, y - 4.6, x + 0.25, y - 4.1), 'steel', 0, 5.0)
            m.add(_box(x - 0.25, y + 4.1, x + 0.25, y + 4.6), 'steel', 0, 5.0)
        for i, x in enumerate(range(-30, 31, 5)):
            if (i * 7 + row * 3 + seed) % 5 == 0: continue
            m.vehicle(x, y, 6.0, 2.2, 'bus' if (i + row) % 4 else 'bus2', h=2.5, along=False)
    # ticket booth and benches, people waiting
    m.add(_box(24, -14, 30, -9), 'white', 0, 3.2)
    m.add(_box(23.6, -14.4, 30.4, -8.6), 'canopy', 3.2, 3.6)
    for x in (-20, -10, 0, 10):
        m.add(_box(x - 2, -6.2, x + 2, -5.6), 'steel', 0.4, 0.9)
    for i, (x, y) in enumerate(((-19, -7.2), (-17.5, -6.8), (-9, -7.4), (1, -7.0), (2.5, -7.6), (11, -7.1), (26, -16), (-5, -12), (5, -15))):
        m.person(x, y, 'robe' if i % 3 else 'person')
    # a couple of taxis waiting at the kerb
    for x in (-28, -22, 30):
        m.vehicle(x, -18, 4.5, 1.8, 'car', h=1.5)
    return m


MODELS = {'mosque': mosque, 'hospital': hospital, 'garage_bab1': lambda: garage(0), 'garage_bab2': lambda: garage(2), 'garage_souq': lambda: garage(4)}


def landmark_parts(mx, my):
    """Every part of every landmark in metre space (x = lng * mx, y = lat * my): [(geom, props)], plus the lot outlines."""
    out, lots = [], []
    for key, (lng, lat, ang, side) in SITES.items():
        model = MODELS[key]()
        cx, cy = lng * mx, lat * my
        # local y (away from the road) is the road's normal on this side; the model's front (y < 0) faces the road
        rot = ang if side > 0 else ang + 180
        lot = None
        for g, part, base, top in model.parts:
            w = af.translate(af.rotate(g, rot, origin=(0, 0)), cx, cy)
            out.append((w, {'lm': key.split('_')[0], 'part': part, 'hm': top, 'base': base}))
            if part in ('pave', 'yard') and lot is None: lot = w
        lots.append(lot)
    return out, lots
