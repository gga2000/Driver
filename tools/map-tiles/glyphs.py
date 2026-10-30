# Signed-distance-field glyphs for MapLibre labels in IBM Plex Sans Arabic (the brand font), so map text
# matches the apps. Writes out/fonts/<fontstack>/<start>-<end>.pbf, the layout MapLibre's `glyphs` URL
# template expects. Same encoding as Mapbox's node-fontnik / MapLibre's TinySDF: 24 px em, 3 px buffer,
# radius 8, cutoff 0.25. Arabic is shaped in the browser by the RTL text plugin into presentation forms
# (U+FB50–U+FEFF), which this font carries, so every range with a glyph in the font is written.
# usage: python3 glyphs.py   (finds the TTFs in node_modules after `pnpm install`, or set PLEX_ARABIC_DIR)
import glob, math, os, sys
import numpy as np, freetype
from scipy.ndimage import distance_transform_edt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out', 'fonts')
WEIGHTS = {'Regular': '400Regular', 'Medium': '500Medium', 'Bold': '700Bold'}
EM, BUFFER, RADIUS, CUTOFF = 24, 3, 8, 0.25
OVERSAMPLE = 4          # draw at 96 px, measure distances there, then average down to 24 px
TOP_ORIGIN = 27         # glyph `top` is measured from an origin above the em box (MapLibre calibrates TinySDF to 27.5)

def font_path(weight_dir):
    d = os.environ.get('PLEX_ARABIC_DIR')
    pats = [os.path.join(d, f'IBMPlexSansArabic_{weight_dir}.ttf')] if d else []
    pats.append(os.path.join(ROOT, 'node_modules', '.pnpm', '@expo-google-fonts+ibm-plex-sans-arabic@*', 'node_modules',
                             '@expo-google-fonts', 'ibm-plex-sans-arabic', weight_dir, f'IBMPlexSansArabic_{weight_dir}.ttf'))
    for p in pats:
        hits = sorted(glob.glob(p))
        if hits: return hits[-1]
    sys.exit(f'IBM Plex Sans Arabic {weight_dir} not found: run `pnpm install` or set PLEX_ARABIC_DIR')

# --- protobuf (glyphs.proto: glyphs{stacks{name, range, glyphs{id, bitmap, width, height, left, top, advance}}}) ---
def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F; n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n: return bytes(out)
def field_varint(no, n): return varint(no << 3) + varint(n)
def field_sint(no, n): return field_varint(no, (n << 1) ^ (n >> 31))
def field_bytes(no, b): return varint((no << 3) | 2) + varint(len(b)) + b

def sdf_glyph(face, cp):
    face.load_char(chr(cp), freetype.FT_LOAD_RENDER | freetype.FT_LOAD_NO_HINTING)
    g = face.glyph; bm = g.bitmap
    advance = round(g.advance.x / 64 / OVERSAMPLE)
    if bm.width == 0 or bm.rows == 0:
        return dict(id=cp, width=0, height=0, left=0, top=-TOP_ORIGIN, advance=advance, bitmap=b'')
    a = np.array(bm.buffer, dtype=np.uint8).reshape(bm.rows, bm.pitch)[:, :bm.width]
    # snap the ink box to whole 24 px pixels so the down-sampled bitmap stays aligned to the glyph origin
    left_hi, top_hi = g.bitmap_left, g.bitmap_top
    left = math.floor(left_hi / OVERSAMPLE); top = math.ceil(top_hi / OVERSAMPLE)
    ox, oy = left_hi - left * OVERSAMPLE, top * OVERSAMPLE - top_hi
    w = math.ceil((ox + bm.width) / OVERSAMPLE); h = math.ceil((oy + bm.rows) / OVERSAMPLE)
    pad = BUFFER * OVERSAMPLE
    W, H = (w + 2 * BUFFER) * OVERSAMPLE, (h + 2 * BUFFER) * OVERSAMPLE
    ink = np.zeros((H, W), dtype=bool)
    ink[pad + oy:pad + oy + bm.rows, pad + ox:pad + ox + bm.width] = a >= 128
    d = distance_transform_edt(~ink) - distance_transform_edt(ink)          # + outside, - inside, in 96 px pixels
    d = d.reshape(H // OVERSAMPLE, OVERSAMPLE, W // OVERSAMPLE, OVERSAMPLE).mean(axis=(1, 3)) / OVERSAMPLE
    v = np.clip(np.round(255 * (1 - CUTOFF) - 255 / RADIUS * d), 0, 255).astype(np.uint8)
    return dict(id=cp, width=w, height=h, left=left, top=top - TOP_ORIGIN, advance=advance, bitmap=v.tobytes())

def encode(stack, start, glyphs):
    body = field_bytes(1, stack.encode()) + field_bytes(2, f'{start}-{start + 255}'.encode())
    for g in glyphs:
        gb = (field_varint(1, g['id']) + (field_bytes(2, g['bitmap']) if g['bitmap'] else b'') + field_varint(3, g['width'])
              + field_varint(4, g['height']) + field_sint(5, g['left']) + field_sint(6, g['top']) + field_varint(7, g['advance']))
        body += field_bytes(3, gb)
    return field_bytes(1, body)

for name, weight_dir in WEIGHTS.items():
    stack = f'IBM Plex Sans Arabic {name}'
    face = freetype.Face(font_path(weight_dir)); face.set_pixel_sizes(0, EM * OVERSAMPLE)
    cps = sorted({cp for cp, _ in face.get_chars() if cp < 65536})
    os.makedirs(os.path.join(OUT, stack), exist_ok=True)
    files = 0
    for start in range(0, 65536, 256):
        inside = [cp for cp in cps if start <= cp < start + 256]
        if not inside: continue
        with open(os.path.join(OUT, stack, f'{start}-{start + 255}.pbf'), 'wb') as fh:
            fh.write(encode(stack, start, [sdf_glyph(face, cp) for cp in inside]))
        files += 1
    print(stack, len(cps), 'glyphs,', files, 'ranges')
