import { describe, expect, it } from 'vitest';
import { LANDMARK_CATEGORIES, type LandmarkCategory, type LandmarkFeed } from '@driver/contracts';
import { glyphSvgMarkup, LANDMARK_GLYPHS, landmarkGlyph } from './landmark-icons.js';
import {
  EMPTY_LANDMARK_FEED,
  LANDMARK_PRIORITY,
  LANDMARK_RULES,
  landmarkIconRect,
  landmarkNamesVisible,
  landmarksVisible,
  markerKeepOut,
  mergeLandmarkFeed,
  placeLandmarks,
  type LandmarkCamera,
  type LandmarkPoint,
} from './landmarks.js';
import { labelBox, rectsOverlap } from './labels.js';
import type { GeoPoint } from './project.js';

/** A flat test projection: 1 px per 1e-4 degree, so a point can be put at a screen spot. */
const at = (x: number, y: number): GeoPoint => ({ lng: 45 + x / 10_000, lat: 33 - y / 10_000 });
const project = (p: GeoPoint) => ({ x: Math.round((p.lng - 45) * 10_000 * 1e6) / 1e6, y: Math.round((33 - p.lat) * 10_000 * 1e6) / 1e6 });
const SIZE = { w: 400, h: 600 };
const lm = (id: string, x: number, y: number, category: LandmarkCategory = 'other', name_ar = id): LandmarkPoint => ({ id, name_ar, category, pin: at(x, y) });
const view = (over: Partial<LandmarkCamera> = {}): LandmarkCamera => ({ zoom: 16.5, size: SIZE, project, lite: false, obstacles: [], ...over });

describe('landmark zoom rules (maps program b3)', () => {
  it('icons from 15, names from 16; lite later and without names', () => {
    expect(landmarksVisible(14.9, false)).toBe(false);
    expect(landmarksVisible(15, false)).toBe(true);
    expect(landmarkNamesVisible(15.9, false)).toBe(false);
    expect(landmarkNamesVisible(16, false)).toBe(true);
    expect(landmarksVisible(15.5, true)).toBe(false);
    expect(landmarksVisible(LANDMARK_RULES.liteMinZoom, true)).toBe(true);
    expect(landmarkNamesVisible(18, true)).toBe(false);
  });

  it('draws nothing below the zoom, names only from the name zoom', () => {
    const items = [lm('a', 200, 300, 'mosque', 'جامع')];
    expect(placeLandmarks(items, view({ zoom: 14.5 }))).toEqual([]);
    expect(placeLandmarks(items, view({ zoom: 15.5 }))).toEqual([{ id: 'a', category: 'mosque', x: 200, y: 300, name: null }]);
    expect(placeLandmarks(items, view({ zoom: 16 }))[0]?.name).toBe('جامع');
  });

  it('lite mode: at most a few, the important ones, no names', () => {
    const items = [...Array.from({ length: 10 }, (_, i) => lm(`o${i}`, 30 + (i % 5) * 70, 80 + Math.floor(i / 5) * 120)), lm('m', 200, 450, 'mosque')];
    const placed = placeLandmarks(items, view({ lite: true, zoom: 17 }));
    expect(placed).toHaveLength(LANDMARK_RULES.liteMax);
    expect(placed[0]?.id).toBe('m');
    expect(placed.every((p) => p.name === null)).toBe(true);
  });

  it('never more than the cap on one screen', () => {
    const grid = Array.from({ length: 80 }, (_, i) => lm(`g${i}`, 20 + (i % 8) * 48, 20 + Math.floor(i / 8) * 56));
    expect(placeLandmarks(grid, view({ zoom: 15.5 })).length).toBeLessThanOrEqual(LANDMARK_RULES.max);
  });
});

describe('placeLandmarks: never under our markers', () => {
  it('a landmark under a pin (its pill rises above the tip) is left out; one well clear stays', () => {
    const pin = at(200, 300);
    const placed = placeLandmarks([lm('under-pill', 230, 260), lm('beside-tip', 200, 320), lm('clear', 200, 420)], view({ obstacles: [{ at: pin }] }));
    expect(placed.map((p) => p.id)).toEqual(['clear']);
  });

  it('the centre pin keeps a narrow column: a landmark just beside its head stays', () => {
    const centre = { centre: true as const, up: 54, halfW: 23 };
    const placed = placeLandmarks([lm('on-head', 200, 260), lm('beside', 250, 280)], view({ obstacles: [centre] }));
    expect(placed.map((p) => p.id)).toEqual(['beside']);
  });

  it('no placed badge or name ever touches a marker box, a blocked word or another landmark', () => {
    const items = Array.from({ length: 60 }, (_, i) => lm(`l${i}`, 15 + ((i * 53) % 370), 15 + ((i * 97) % 570), LANDMARK_CATEGORIES[i % LANDMARK_CATEGORIES.length]!, `معلم رقم ${i}`));
    const obstacles = [{ at: at(120, 200) }, { at: at(300, 450), up: 60 }];
    const zoneName = labelBox({ x: 200, y: 100, name: 'العزيزية (مركز)' });
    const placed = placeLandmarks(items, view({ obstacles, blocked: [zoneName] }));
    expect(placed.length).toBeGreaterThan(5);
    const boxes = placed.map((p) => landmarkIconRect(p.x, p.y));
    const keepOut = obstacles.map((o) => markerKeepOut({ ...project(o.at), up: o.up ?? 0 }));
    for (const b of boxes) {
      for (const k of [...keepOut, zoneName]) expect(rectsOverlap(b, k)).toBe(false);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(rectsOverlap(boxes[i]!, boxes[j]!)).toBe(false);
  });

  it('a name that would collide is dropped alone; the badge stays', () => {
    // Two badges close together: room for both badges, not for both long names.
    const placed = placeLandmarks([lm('a', 180, 300, 'mosque', 'جامع العزيزية الكبير'), lm('b', 230, 268, 'school', 'مدرسة العزيزية الابتدائية')], view());
    expect(placed.map((p) => [p.id, p.name !== null])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });

  it('off-screen and edge-clipped landmarks are not drawn', () => {
    expect(placeLandmarks([lm('out', -30, 300), lm('edge', 3, 300), lm('in', 100, 300)], view({ zoom: 15.5 })).map((p) => p.id)).toEqual(['in']);
  });
});

describe('placeLandmarks: who wins a crowded spot', () => {
  it('mosque before bridge before market … before other; then nearest the middle; then id', () => {
    const order = Object.entries(LANDMARK_PRIORITY)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
    expect(order).toEqual(['mosque', 'bridge', 'market', 'school', 'clinic', 'fuel', 'garage', 'other']);
    // Overlapping badges: only the winner shows.
    expect(placeLandmarks([lm('o', 200, 300, 'other'), lm('m', 205, 302, 'market')], view()).map((p) => p.id)).toEqual(['m']);
    expect(placeLandmarks([lm('far', 30, 30, 'school'), lm('near', 100, 100, 'school'), lm('mid', 200, 300, 'school')], view({ zoom: 15.5 })).map((p) => p.id)).toEqual(['mid', 'near', 'far']);
    expect(placeLandmarks([lm('b', 200, 300), lm('a', 200, 300)], view()).map((p) => p.id)).toEqual(['a']);
  });
});

describe('mergeLandmarkFeed', () => {
  const ITEM = { id: 'x', name_ar: 'جامع', category: 'mosque' as const, pin: { lat: 32.9, lng: 45.06 }, photoUrl: null };
  const full: LandmarkFeed = { changed: true, etag: 'e1', maxAgeS: 60, landmarks: [ITEM] };

  it('a full answer replaces; "unchanged" keeps the list', () => {
    const kept = mergeLandmarkFeed(undefined, full);
    expect(kept).toEqual({ etag: 'e1', landmarks: [ITEM] });
    expect(mergeLandmarkFeed(kept, { changed: false, etag: 'e1', maxAgeS: 60 })).toBe(kept);
  });

  it('"unchanged" for an etag it does not hold drops the etag, so the next ask is full', () => {
    expect(mergeLandmarkFeed(undefined, { changed: false, etag: 'e1', maxAgeS: 60 })).toBe(EMPTY_LANDMARK_FEED);
    expect(mergeLandmarkFeed({ etag: 'e0', landmarks: [ITEM] }, { changed: false, etag: 'e1', maxAgeS: 60 })).toBe(EMPTY_LANDMARK_FEED);
  });
});

describe('landmark icons', () => {
  it('every category has a glyph on the 24 px grid', () => {
    for (const c of LANDMARK_CATEGORIES) {
      const shapes = landmarkGlyph(c);
      expect(shapes.length, c).toBeGreaterThan(0);
      const nums = shapes.flatMap((s) => ('d' in s ? (s.d.match(/-?\d*\.?\d+/g) ?? []).map(Number) : 'circle' in s ? [...s.circle] : [...s.rect]));
      for (const n of nums) expect(Math.abs(n), c).toBeLessThanOrEqual(24);
    }
    expect(Object.keys(LANDMARK_GLYPHS).sort()).toEqual([...LANDMARK_CATEGORIES].sort());
  });

  it('the garage is the very garage icon of @driver/ui (its paths.test pins the same drawing)', () => {
    expect(landmarkGlyph('garage')).toEqual([{ d: 'M3 21V9l9-5 9 5v12' }, { d: 'M7 21v-8.5h10V21' }, { d: 'M7 16.5h10' }]);
  });

  it('distinct categories read differently (no two share a drawing)', () => {
    const drawings = LANDMARK_CATEGORIES.map((c) => JSON.stringify(landmarkGlyph(c)));
    expect(new Set(drawings).size).toBe(drawings.length);
  });

  it('renders as SVG markup for the Console', () => {
    expect(glyphSvgMarkup(landmarkGlyph('clinic'))).toBe('<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.25v7.5M8.25 12h7.5"/>');
    expect(glyphSvgMarkup(landmarkGlyph('other'))).toBe('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.25"/>');
  });
});
