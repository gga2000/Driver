import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  buildGoldenStyle,
  twinkleRiver,
  FURROW_PATTERN,
  GOLDEN_FIRST_LABEL,
  GOLDEN_FONTS,
  GOLDEN_PALETTES,
  GOLDEN_SEQUIN_LAYERS,
  GOLDEN_SOURCE,
  GOLDEN_ZONE_NAMES_SOURCE,
  GOLDEN_ZONES_SOURCE,
  LANDMARK_PARTS,
  LANDMARK_RISE,
  goldenImages,
  lightFor,
  PALM_PATTERN,
  palmPattern,
  resolveLight,
  shadowOffset,
  sunAt,
  type GoldenLight,
  type GoldenMode,
} from './index.js';

const base = { pmtilesUrl: 'pmtiles://https://tiles.example.test/wasit.pmtiles', glyphs: 'https://tiles.example.test/fonts/{fontstack}/{range}.pbf' };
const LIGHTS: GoldenLight[] = ['day', 'morning', 'golden', 'sunset', 'night'];
const MODES: GoldenMode[] = ['customer', 'courier', 'console', 'lite'];
const ids = (s: ReturnType<typeof buildGoldenStyle>) => s.layers.map((l) => l.id);

describe('the sun over Aziziyah', () => {
  // Aziziyah is UTC+3; 9 Oct sunrise ≈ 05:55, solar noon ≈ 11:50, sunset ≈ 17:45 local.
  it('is high at noon, low in the late afternoon and below the horizon at night', () => {
    const noon = sunAt(new Date('2026-10-09T08:50:00Z'));
    expect(noon.alt).toBeGreaterThan(50);
    expect(noon.az).toBeGreaterThan(160);
    expect(noon.az).toBeLessThan(200);
    expect(lightFor(noon)).toBe('day');
    expect(lightFor(sunAt(new Date('2026-10-09T13:45:00Z')))).toBe('golden'); // 16:45, in the west
    expect(lightFor(sunAt(new Date('2026-10-09T03:45:00Z')))).toBe('morning'); // 06:45, in the east
    expect(lightFor(sunAt(new Date('2026-10-09T14:50:00Z')))).toBe('sunset'); // 17:50, maghrib
    expect(lightFor(sunAt(new Date('2026-10-09T19:00:00Z')))).toBe('night');
  });
  it('follows the clock by default and keeps a pinned light', () => {
    expect(resolveLight({ now: new Date('2026-10-09T19:00:00Z') }).light).toBe('night');
    expect(resolveLight({ light: 'golden', now: new Date('2026-10-09T19:00:00Z') }).light).toBe('golden');
  });
});

describe('buildGoldenStyle', () => {
  it('is a valid MapLibre style for every light and every screen', () => {
    for (const light of LIGHTS) {
      for (const mode of MODES) {
        const style = buildGoldenStyle({ ...base, light, mode });
        expect(validateStyleMin(style), `${light}/${mode}`).toEqual([]);
        expect(style.glyphs).toBe(base.glyphs);
        expect(style.sources[GOLDEN_SOURCE]).toMatchObject({ type: 'vector', url: base.pmtilesUrl });
        expect(new Set(ids(style)).size).toBe(style.layers.length);
      }
    }
  });
  it('draws the Console neighbourhoods on customer and lite only, under the houses, never the AI draft outlines', () => {
    for (const mode of MODES) {
      const style = buildGoldenStyle({ ...base, light: 'golden', mode, zoneNames: true });
      const zoneIds = style.layers.filter((l) => 'source' in l && (l.source === GOLDEN_ZONES_SOURCE || l.source === GOLDEN_ZONE_NAMES_SOURCE)).map((l) => l.id);
      if (mode === 'customer' || mode === 'lite') {
        expect(style.sources[GOLDEN_ZONES_SOURCE]).toMatchObject({ type: 'geojson' });
        expect(style.sources[GOLDEN_ZONE_NAMES_SOURCE]).toMatchObject({ type: 'geojson' });
        expect(zoneIds).toEqual(['golden-zone-wash', 'golden-zone-edge', 'golden-zone-names']);
        for (const id of ['golden-zone-wash', 'golden-zone-edge']) expect(style.layers.find((l) => l.id === id)).toMatchObject({ filter: ['!=', ['get', 'placement'], 'draft'] });
        // every neighbourhood keeps its name, drawn or not
        expect(style.layers.find((l) => l.id === 'golden-zone-names')).not.toHaveProperty('filter');
        expect(ids(style).indexOf('golden-zone-edge')).toBeLessThan(ids(style).indexOf('golden-roofs'));
        expect(ids(style).indexOf('golden-zone-names')).toBeGreaterThan(ids(style).indexOf('golden-roofs'));
      } else {
        // courier and Console lay their own zone layers on this source
        expect(style.sources[GOLDEN_ZONES_SOURCE]).toBeUndefined();
        expect(zoneIds).toEqual([]);
      }
    }
    // names stay off until the app stops drawing its own
    expect(ids(buildGoldenStyle({ ...base, light: 'day', mode: 'customer' }))).not.toContain('golden-zone-names');
  });
  it('reads only the layers the tiles carry and only the fonts glyphs.py writes', () => {
    const style = buildGoldenStyle({ ...base, light: 'golden', mode: 'courier' });
    const sourceLayers = new Set(style.layers.flatMap((l) => ('source-layer' in l && l['source-layer'] ? [l['source-layer']] : [])));
    expect([...sourceLayers].sort()).toEqual(['buildings', 'landmarks', 'landuse', 'lanterns', 'localities', 'palms', 'places', 'roads', 'water']);
    const night = buildGoldenStyle({ ...base, light: 'night', mode: 'customer' });
    expect(night.layers.filter((l) => 'source-layer' in l && l['source-layer'] === 'lights').map((l) => l.id)).toEqual(['golden-window-glow']);
    // the lantern strings and the lamp posts: lit glass and warm pools on the street at night, no pools by day; palms always
    expect(night.layers.filter((l) => 'source-layer' in l && l['source-layer'] === 'lanterns').map((l) => l.id)).toEqual(['golden-lantern-glow', 'golden-lanterns', 'golden-street-lamp-glow', 'golden-street-furniture']);
    expect(style.layers.filter((l) => 'source-layer' in l && l['source-layer'] === 'lanterns').map((l) => l.id)).toEqual(['golden-lanterns', 'golden-street-furniture']);
    const flat = buildGoldenStyle({ ...base, light: 'night', mode: 'console' });
    expect(flat.layers.some((l) => 'source-layer' in l && l['source-layer'] === 'lanterns')).toBe(false);
    const fonts = new Set<string>(Object.values(GOLDEN_FONTS).flat());
    for (const l of style.layers) {
      if (l.type === 'symbol') for (const f of (l.layout?.['text-font'] as string[]) ?? []) expect(fonts.has(f)).toBe(true);
    }
  });
  it('widens streets past z18 and turns them to tarmac at street level', () => {
    const style = buildGoldenStyle({ ...base, light: 'golden' });
    const minor = style.layers.find((l) => l.id === 'golden-minor') as { paint: Record<string, unknown[]> };
    const width = minor.paint['line-width']!;
    expect(width.slice(-2)).toEqual([20, 72]); // a 6–8 m side street up close, not a hairline
    const colour = minor.paint['line-color']!;
    expect(colour.at(-1)).toBe(GOLDEN_PALETTES.golden.asphalt.minor);
    expect(colour[4]).toBe(GOLDEN_PALETTES.golden.minor); // the cream town view Ali picked stays when zoomed out
  });
  it('keeps labels on top, so routes added before GOLDEN_FIRST_LABEL never hide a street name', () => {
    const style = buildGoldenStyle({ ...base, light: 'day' });
    const first = ids(style).indexOf(GOLDEN_FIRST_LABEL);
    expect(first).toBeGreaterThan(0);
    expect(style.layers.slice(first).every((l) => l.type === 'symbol')).toBe(true);
    // the one exception is paint on the ground: neighbourhood names lie under the houses (and under a route)
    expect(style.layers.slice(0, first).filter((l) => l.type === 'symbol').map((l) => l.id)).toEqual(['golden-area-names']);
  });
  it('draws less where less is needed: no 3D, shadows or patterns on the Console and cheap phones', () => {
    for (const mode of ['console', 'lite'] as const) {
      const style = buildGoldenStyle({ ...base, light: 'golden', mode });
      expect(style.layers.some((l) => l.type === 'fill-extrusion')).toBe(false);
      expect(ids(style).some((id) => id.startsWith('golden-shadow') || id.startsWith('golden-glint') || id === 'golden-palm-crowns')).toBe(false);
      expect(style.sky).toBeUndefined();
    }
    const courier = buildGoldenStyle({ ...base, light: 'golden', mode: 'courier' });
    expect(courier.sky).toBeDefined();
    const rise = (s: typeof courier) => s.layers.find((l) => l.id === 'golden-houses-3d')!.minzoom!;
    expect(rise(courier)).toBeLessThan(rise(buildGoldenStyle({ ...base, light: 'golden', mode: 'customer' })));
  });

  it('stands bridges up with the houses, the stair huts just after, and the small tanks and dishes only up close', () => {
    const style = buildGoldenStyle({ ...base, light: 'golden', mode: 'customer' });
    const z = (id: string) => style.layers.find((l) => l.id === id)!.minzoom!;
    expect(z('golden-roof-huts')).toBeGreaterThan(z('golden-houses-3d'));
    expect(z('golden-roof-tanks')).toBeGreaterThan(z('golden-roof-huts'));
    expect(z('golden-bridge-3d')).toBe(z('golden-houses-3d'));
  });
  it('stands the landmarks up before the houses, and shows their plan flat on the Console and cheap phones', () => {
    const style = buildGoldenStyle({ ...base, light: 'golden', mode: 'customer' });
    const z = (id: string) => style.layers.find((l) => l.id === id)!.minzoom!;
    expect(z('golden-landmarks-3d')).toBe(LANDMARK_RISE);
    expect(LANDMARK_RISE).toBeLessThan(z('golden-houses-3d'));
    for (const mode of ['console', 'lite'] as const) {
      const flat = buildGoldenStyle({ ...base, light: 'golden', mode });
      expect(ids(flat)).toContain('golden-landmarks');
      expect(ids(flat)).not.toContain('golden-landmarks-3d');
    }
  });
  it('lights the main streets like sodium lamps at night only, and casts no shadows in the dark', () => {
    const night = ids(buildGoldenStyle({ ...base, light: 'night' }));
    expect(night).toContain('golden-lamp-glow');
    expect(night.some((id) => id.startsWith('golden-shadow'))).toBe(false);
    const day = ids(buildGoldenStyle({ ...base, light: 'day' }));
    expect(day).not.toContain('golden-lamp-glow');
    expect(day.filter((id) => id.startsWith('golden-shadow'))).toHaveLength(3);
  });
});

describe('shadows', () => {
  it('fall away from the sun and lengthen as it sinks', () => {
    const west = { az: 260, alt: 14 };
    const [x, y] = shadowOffset(west, 6.8, 18);
    expect(x).toBeGreaterThan(0); // sun in the west → shadow to the east (right)
    expect(Math.abs(y)).toBeLessThan(Math.abs(x));
    expect(Math.hypot(...shadowOffset({ az: 260, alt: 50 }, 6.8, 18))).toBeLessThan(Math.hypot(x, y));
    // doubling per zoom level, like the map itself
    expect(shadowOffset(west, 6.8, 19)[0]).toBeCloseTo(x * 2, 0);
  });
});

describe('palettes', () => {
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 0.04) return null; // grey: no hue to judge
    const h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    return (h * 60 + 360) % 360;
  };
  it('never use blue or teal (brand rule): water is olive, night is brown', () => {
    for (const [light, p] of Object.entries(GOLDEN_PALETTES)) {
      for (const [key, value] of [...Object.entries(p), ...Object.entries(p.landmark).map(([k, v]) => [`landmark.${k}`, v] as const)]) {
        if (typeof value !== 'string') continue;
        const h = hue(value);
        if (h !== null) expect(h < 160 || h > 260, `${light}.${key} ${value}`).toBe(true);
      }
    }
  });
});

describe('landmark colours', () => {
  it('colour every part the tiles carry, in every light', () => {
    for (const p of Object.values(GOLDEN_PALETTES)) expect(Object.keys(p.landmark).sort()).toEqual([...LANDMARK_PARTS].sort());
  });
});

describe('palm pattern', () => {
  it('is a 36 px opaque tile in the grove colours, with crowns drawn on it', () => {
    const img = palmPattern(GOLDEN_PALETTES.golden);
    expect(img.width).toBe(36);
    expect(img.data).toHaveLength(36 * 36 * 4);
    const alphas = new Set<number>();
    const colours = new Set<string>();
    for (let i = 0; i < img.data.length; i += 4) {
      alphas.add(img.data[i + 3]!);
      colours.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
    }
    expect([...alphas]).toEqual([255]);
    expect(colours.size).toBeGreaterThan(5);
    expect(Object.keys(goldenImages('night')).slice(0, 2)).toEqual([PALM_PATTERN, FURROW_PATTERN]);
  });
});

describe('river sequins', () => {
  it('scatters nine rows of points on the river from the town view, none on lite', () => {
    const style = buildGoldenStyle({ ...base, light: 'golden', mode: 'customer' });
    expect(ids(style).filter((id) => id.startsWith('golden-glint-'))).toEqual([...GOLDEN_SEQUIN_LAYERS]);
    expect(GOLDEN_SEQUIN_LAYERS).toHaveLength(9);
    expect(style.layers.find((l) => l.id === 'golden-glint-1')).toMatchObject({ minzoom: 12.5, paint: { 'line-dasharray': [0, 6] } });
    expect(ids(buildGoldenStyle({ ...base, light: 'golden', mode: 'lite' })).some((id) => id.startsWith('golden-glint-'))).toBe(false);
  });
  it('twinkles once and comes to rest where the style draws it; still with reduce motion', () => {
    const style = buildGoldenStyle({ ...base, light: 'golden', mode: 'customer' });
    const set: Record<string, unknown> = {};
    let brighter = false;
    const paintOf = (id: string) => (style.layers.find((l) => l.id === id) as { paint: Record<string, unknown> }).paint['line-opacity'];
    const map = { getLayer: (id: string) => style.layers.find((l) => l.id === id), setPaintProperty: (id: string, _n: string, v: unknown) => { if (JSON.stringify(v) !== JSON.stringify(paintOf(id))) brighter = true; set[id] = v; } };
    const queue: ((t: number) => void)[] = [];
    twinkleRiver(map, { ms: 100, frame: (cb) => queue.push(cb), cancel: () => {} });
    for (let t = 0; queue.length; t += 16) queue.shift()!(t);
    expect(brighter).toBe(true);
    for (const id of GOLDEN_SEQUIN_LAYERS) expect(set[id]).toEqual(paintOf(id));
    const still: Record<string, unknown> = {};
    twinkleRiver({ ...map, setPaintProperty: (id, _n, v) => { still[id] = v; } }, { reduceMotion: true });
    expect(still).toEqual({});
  });
});
