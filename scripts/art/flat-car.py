"""
The flat top-down saloon under the الرجعة seat map (partner check-up item 5, Ali 2026-10-09: no
glossy pictures). Date brown body, saffron lights, toned saffron glass, cream seats, on the seat map's cream.
Seat centres match `CAR_ART_LAYOUTS.sedan` (percent of 688 x 1024). Writes the same picture to the
customer and partner apps:  python3 scripts/art/flat-car.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

W, H, S = 688, 1024, 4  # drawn 4x, then downsampled for clean edges
BG = '#FEF6E4'
BODY = '#5A3118'      # trips.light, date brown
DARK = '#2A170C'      # trips.fill
GLASS = '#FFC155'     # trips.on, saffron gold
CABIN = '#F3E4D3'     # trips.tint
SEAT = '#FFF8EC'
SEAT_BACK = '#E9D3B6'
CONSOLE = '#D9BE9C'
WINDOW = '#E3A447'    # the glass, saffron toned down so the seats lead
SEAM = '#4A2813'

img = Image.new('RGB', (W * S, H * S), BG)
d = ImageDraw.Draw(img)


def P(x, y):
    return (x / 100 * W * S, y / 100 * H * S)


def box(x0, y0, x1, y1, r, fill):
    a, b = P(x0, y0), P(x1, y1)
    d.rounded_rectangle([a, b], radius=r / 100 * W * S, fill=fill)


def poly(points, fill):
    d.polygon([P(x, y) for x, y in points], fill=fill)


def ring(cx, cy, r, width, color):
    c = P(cx, cy)
    rr = r / 100 * W * S
    d.ellipse([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], outline=color, width=int(width / 100 * W * S))


# Body: a smooth saloon outline, a touch narrower at the nose than the tail.
def half_width(y):
    t = (y - 50) / 47.5
    k = 0.95 + 0.02 * t
    return 32 * k * max(0.0, 1 - abs(t) ** 5) ** (1 / 5)


def outline(inset=0.0):
    ys = [2.5 + i * 95 / 400 for i in range(401)]
    right = [(50 + max(0.0, half_width(y) - inset), y) for y in ys]
    return right + [(100 - x, y) for x, y in reversed(right)]


# Mirrors at the foot of the windscreen.
box(13, 26.5, 20, 29.5, 1.6, BODY)
box(80, 26.5, 87, 29.5, 1.6, BODY)
poly(outline(), BODY)
# Hood and boot seams.
for y in (21.5, 82.5):
    box(26, y, 74, y + 0.35, 0.2, SEAM)
# Head and tail lights.
box(30, 5.6, 40, 6.8, 0.6, GLASS)
box(60, 5.6, 70, 6.8, 0.6, GLASS)
box(31, 93.2, 69, 94.2, 0.5, GLASS)
# Windscreen and rear glass.
poly([(31.5, 22.5), (68.5, 22.5), (75, 28.2), (25, 28.2)], WINDOW)
poly([(25, 74.2), (75, 74.2), (70.5, 81.2), (29.5, 81.2)], WINDOW)
# Open cabin with saffron side windows.
box(23, 28.2, 77, 74.2, 3, WINDOW)
box(24.8, 28.2, 75.2, 74.2, 2.6, CABIN)
# Dashboard and steering wheel (driver on the left).
box(24.8, 28.2, 75.2, 31.6, 1.2, DARK)
ring(36.3, 33.4, 4.4, 1.2, DARK)
# Front seats, backs towards the rear.
for cx in (36.3, 63.2):
    box(cx - 9.5, 37, cx + 9.5, 49.5, 3, SEAT)
    box(cx - 9.5, 47.2, cx + 9.5, 51.5, 2, SEAT_BACK)
box(47, 34, 53, 53, 1.6, CONSOLE)
# Rear bench for three.
box(27, 57.5, 73, 69.5, 3, SEAT)
box(27, 67.5, 73, 72.2, 2, SEAT_BACK)
for x in (42.5, 56.8):
    box(x - 0.25, 58.5, x + 0.25, 67, 0.25, SEAT_BACK)

out = img.resize((W, H), Image.LANCZOS)
root = Path(__file__).resolve().parents[2]
for app in ('customer', 'partner'):
    path = root / 'apps' / app / 'assets' / 'cars' / 'sedan.webp'
    out.save(path, 'WEBP', quality=90, method=6)
    print(path.relative_to(root), path.stat().st_size, 'bytes')
