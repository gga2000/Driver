# Landmarks in 3D: the main mosque, the hospital and the intercity garages (Ali, 2026-10-09: "not real spot, make a
# good looking design for each"; the garages are the new terminal look he picked on 2026-10-10). Each model is drawn in metres around its site, the front facing the main road it
# sits on, and comes out as small extruded parts, each with a `part` the style colours by light.
#
# The mosque and hospital are design spots, not surveyed ones: an empty lot beside a main road, off the river, near
# where the place is believed to be. The garages are at Ali's real spots (2026-10-10).
import math
import shapely, shapely.affinity as af, shapely.geometry as sg

SITES = {
    # key: (lng, lat of the lot centre, road angle in degrees, side of the road), sizes are the model's own
    'mosque': (45.05873, 32.90695, -112, 1),
    'hospital': (45.06723, 32.90885, -37, 1),
    # The garages where they really are (Ali's Google Maps pins, 2026-10-10, matched to our tiles within ~30 m); each lot
    # is nudged off the streets round it (≤ 22 m) and sized to fit between them (GARAGE_SIZE).
    'garage_bab1': (45.04035, 32.91590, -8, 1),   # north of the Kut road at الشارع الجديد, west of the canal
    'garage_bab2': (45.06407, 32.91543, 168, 1),  # south of the Kut road, east of شارع الخليج العربي
    'garage_souq': (45.06648, 32.90227, -24, 1),  # north of الشارع الجديد, ~200 m NW of the bridge road
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


def _fleet(m, x, y, kind, along=False, rack=None):
    """The garage fleet: Hyundai H-1 / Kia minibus, GMC Suburban, Coaster, and the orange-band taxi."""
    L, Wd, H = {'h1': (5.1, 1.9, 2.0), 'gmc': (5.7, 2.0, 1.9), 'coaster': (7.0, 2.1, 2.7), 'taxi': (4.5, 1.8, 1.5)}[kind]
    b = _box(x - L / 2, y - Wd / 2, x + L / 2, y + Wd / 2) if along else _box(x - Wd / 2, y - L / 2, x + Wd / 2, y + L / 2)
    body = {'h1': 'bus', 'gmc': 'car', 'coaster': 'bus2', 'taxi': 'bus'}[kind]
    m.add(b, body, 0.3, H * 0.55)
    m.add(b.buffer(0.04, join_style='mitre'), 'glass', H * 0.55, H * 0.8)
    m.add(b.buffer(-0.2, join_style='mitre'), body, H * 0.8, H)
    if kind == 'taxi': m.add(b.buffer(0.05, join_style='mitre'), 'taxiband', 0.75, 1.0)
    if kind == 'coaster': m.add(b.buffer(0.05, join_style='mitre'), 'car2', 1.0, 1.25)
    if rack:  # bags tied on the roof rack
        c = b.centroid
        for i, (dx, dy) in enumerate(((-0.4, -0.7), (0.35, 0.1), (-0.3, 0.9))):
            px, py = (c.x + dx, c.y + dy) if not along else (c.x + dy, c.y + dx)
            m.add(_box(px - 0.4, py - 0.35, px + 0.4, py + 0.35), rack[i % len(rack)], H, H + 0.55)


def _chair(m, x, y, part):
    m.add(_box(x - 0.22, y - 0.22, x + 0.22, y + 0.22), part, 0.42, 0.5)
    m.add(_box(x - 0.22, y + 0.16, x + 0.22, y + 0.22), part, 0.5, 0.95)


GARAGE_DEST = ('dest1', 'dest2', 'dest3')   # the destination colours on the totem: Baghdad, Kut, Suwaira
GARAGE_RACKS = (('red', 'bus2'), ('crown', 'red'), ('bus2', 'gold'))


def garage(seed=0, W=80, D=48):
    """The new garage terminal (Ali's pick B, 2026-10-10): a wave of white fins over two rows of bays, each fin
    edged in saffron that lights up at night, a glass waiting hall, a tea kiosk, a destination totem, palms on the
    middle island where people wait, taxis at the kerb. W and D fit the real lot; the front (y < 0) faces the road."""
    m = Model(); hw = W / 2; f = -D / 2
    outer = _box(-hw, f, hw, D / 2)
    m.add(outer, 'yard', 0, 0.06)     # first: the lot itself (houses on it give way)
    m.add(outer.difference(outer.buffer(-0.4, join_style='mitre')).difference(_box(-hw + 0.5, f - 1, hw - 0.5, f + 0.5)), 'stone', 0, 1.4)
    # the hall: a glass box under a floating white roof with a saffron fascia
    hx0, hx1 = -hw + 3, -hw + 3 + min(22, W * 0.3)
    m.add(_box(hx0, f + 4.5, hx1, f + 11), 'hall', 0, 4.0)
    for x in range(int(hx0) + 2, int(hx1), 3):
        m.add(_box(x - 0.1, f + 4.42, x + 0.1, f + 4.5), 'trim', 0, 4.0)
    m.add(_box(hx0 - 1.2, f + 2.4, hx1 + 1.2, f + 12), 'roof', 4.4, 4.9)
    m.add(_box(hx0 - 1.2, f + 2.3, hx1 + 1.2, f + 2.4), 'led', 4.1, 4.9)
    for x in (hx0 - 0.6, hx1 + 0.6):
        m.add(_disc(x, f + 2.9, 0.18, 8), 'column', 0, 4.4)
    m.add(_disc((hx0 + hx1) / 2, f + 3.2, 5, 24), 'pool', 0.07, 0.09)
    # a tea kiosk at the hall's end with chairs out front: it is still Aziziyah
    kx = hx1 + 3.2
    m.add(_box(kx - 1.6, f + 6, kx + 1.6, f + 9), 'kiosk', 0, 2.6)
    m.add(_box(kx - 1.9, f + 5.2, kx + 1.9, f + 9.3), 'roof', 2.6, 2.9)
    m.add(_disc(kx - 0.6, f + 5.9, 0.25, 8), 'gold', 1.0, 1.6)
    for k, (x, y) in enumerate(((kx - 1.4, f + 4.2), (kx, f + 3.8), (kx + 1.4, f + 4.3))):
        _chair(m, x, y, 'red' if k % 2 else 'white')
    m.person(kx + 0.7, f + 4.6, 'robe')
    m.add(_disc(kx, f + 5, 3, 16), 'pool', 0.07, 0.09)
    # the totem by the gate, the destinations in their colours
    tx = kx + 5.5
    m.add(_box(tx - 0.9, f + 1, tx + 0.9, f + 1.7), 'steel', 0, 8.5)
    m.add(_box(tx - 0.75, f + 0.95, tx + 0.75, f + 1.0), 'led', 6.0, 8.1)
    for k in range(3):
        m.add(_box(tx - 0.65, f + 0.9, tx + 0.65, f + 0.95), GARAGE_DEST[k], 1.4 + k * 1.4, 2.4 + k * 1.4)
    # the wave: fins across the bays, white on top with a saffron edge under them (a line of light at night)
    ys0, ys1 = f + 14.5, D / 2 - 2
    xs0, xs1 = -hw + 3, hw - 3
    nf = int((xs1 - xs0) / 2.6)
    for k in range(nf + 1):
        x = xs0 + (xs1 - xs0) * k / nf
        z = 6.2 + 1.8 * math.sin(math.pi * (2 * (x - xs0) / (xs1 - xs0) + 0.25))
        m.add(_box(x - 0.55, ys0 - 1.5, x + 0.55, ys1 + 0.8), 'led', z, z + 0.22)
        m.add(_box(x - 0.55, ys0 - 1.5, x + 0.55, ys1 + 0.8), 'roof', z + 0.22, z + 0.45)
    # two spine beams carry the fins on branching columns
    for y in (ys0 + 2.5, ys1 - 2.5):
        m.add(_box(xs0, y - 0.25, xs1, y + 0.25), 'column', 4.0, 4.4)
        for x in range(int(xs0) + 3, int(xs1), 10):
            m.add(_disc(x, y, 0.35, 8), 'column', 0, 4.0)
            for dx in (-0.6, 0.6):
                m.add(_box(x + dx - 0.15, y - 0.15, x + dx + 0.15, y + 0.15), 'column', 3.0, 4.0)
    # two rows of bays facing a middle island with palms and benches, where people wait
    ym = (ys0 + ys1) / 2
    m.add(_box(xs0 + 1, ym - 1.3, xs1 - 1, ym + 1.3), 'pave', 0, 0.22)
    for x in range(int(xs0) + 4, int(xs1) - 2, 8):
        m.palm(x, ym, 5.8)
        m.add(_disc(x, ym, 0.75, 12), 'planter', 0.22, 0.7)
        m.add(_box(x + 1.8, ym - 0.3, x + 3.8, ym + 0.3), 'steel', 0.4, 0.85)
    nb = int((xs1 - xs0 - 2) / 3.6)
    for row, (yb, sgn) in enumerate(((ym - 4.7, -1), (ym + 4.7, 1))):
        for i in range(nb):
            x = xs0 + 2.8 + i * 3.6
            m.add(_box(x - 1.86, yb - 3, x - 1.74, yb + 3), 'paint', 0.06, 0.09)
            if (i * 3 + row * 5 + seed) % 6 != 2:
                k = ('h1', 'gmc', 'h1', 'coaster', 'gmc')[(i + row) % 5]
                _fleet(m, x, yb, k, rack=GARAGE_RACKS[(i + row) % 3] if (i + row) % 3 == 0 else None)
            if (i + row + seed) % 3 == 0:
                m.person(x + 0.8, ym + sgn * 0.8, 'robe' if i % 2 else 'person')
    for x in range(int(xs0) + 6, int(xs1) - 4, 12):
        m.add(_disc(x, ym, 6, 24), 'pool', 0.07, 0.09)
    # the kerb in front: taxis waiting, people walking in
    m.add(_box(tx + 3, f + 3.6, hw - 2, f + 4.0), 'pave', 0, 0.2)
    for x in (tx + 6, tx + 11, tx + 16, tx + 21):
        if x < hw - 4: _fleet(m, x, f + 2.2, 'taxi', along=True)
    for x, y in ((hx0 + 4, f + 2.8), (hx0 + 8, f + 3.4), (tx + 2, f + 6), (0, f + 12.6), (4, f + 12.0), (-6, f + 12.9)):
        m.person(x, y, 'person' if x > 0 else 'robe')
    return m


# Lot size (along the road, away from it), metres: what fits between the streets at each real garage.
GARAGE_SIZE = {'garage_bab1': (70, 44), 'garage_bab2': (70, 44), 'garage_souq': (80, 48)}
MODELS = {
    'mosque': mosque,
    'hospital': hospital,
    'garage_bab1': lambda: garage(0, *GARAGE_SIZE['garage_bab1']),
    'garage_bab2': lambda: garage(2, *GARAGE_SIZE['garage_bab2']),
    'garage_souq': lambda: garage(4, *GARAGE_SIZE['garage_souq']),
}


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
