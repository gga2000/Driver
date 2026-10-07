import type { LandmarkCategory, LandmarkFeed, LandmarkFeedItem } from '@driver/contracts';
import { obstaclesOnScreen, rectsOverlap, textWidth, type LabelObstacle, type ScreenMarker, type ScreenRect } from './labels.js';
import type { GeoPoint } from './project.js';

/**
 * When and how landmarks are drawn (maps program b3). Zooms are MapLibre's (512-px tiles): at 15 a
 * screen is about 800 m across a phone, the scale of "the mosque on the corner"; names from 16, where
 * a street or two fills the screen and the words have room.
 */
export const LANDMARK_RULES = {
  minZoom: 15,
  nameZoom: 16,
  /**
   * Names on the partner job map (Ali 2026-10-07: drivers need them more than anyone): it never zooms
   * past 15.4 and is short and wide, so names show from where its icons do.
   */
  driverNameZoom: 15,
  /** Low-data mode (`useLiteMode`): later, fewer, no names — the map is the drawn town, keep it calm. */
  liteMinZoom: 16,
  liteMax: 6,
  /** Never more than this many on one screen. */
  max: 40,
  /** The round badge, px. */
  iconPx: 22,
  nameFontPx: 10.5,
  /** Badge bottom to the name's top, px. */
  nameGapPx: 2,
  /** Room kept between two landmarks, and around a name, px. */
  spacingPx: 4,
  /**
   * The space a marker keeps clear when its size is not known: our pins' name pills rise ~70 px over
   * the tip and are up to ~150 px wide (half 60 covers most names), a flipped pill hangs ~30 px under.
   */
  markerHalfW: 60,
  markerUp: 72,
  markerDown: 30,
} as const;

/**
 * Which landmark wins a crowded spot: the ones people give directions by first («يم الجامع», «راس
 * الجسر», «بالسوك»), anything else last.
 */
export const LANDMARK_PRIORITY: Readonly<Record<LandmarkCategory, number>> = {
  mosque: 8,
  bridge: 7,
  market: 6,
  school: 5,
  clinic: 4,
  fuel: 3,
  garage: 2,
  other: 1,
};

/** A landmark as a map needs it (a `LandmarkFeedItem` fits). */
export interface LandmarkPoint {
  id: string;
  name_ar: string;
  category: LandmarkCategory;
  pin: GeoPoint;
}

/** A landmark to draw: its badge centred on `x, y`, and its name under it when there was room. */
export interface PlacedLandmark {
  id: string;
  category: LandmarkCategory;
  x: number;
  y: number;
  name: string | null;
}

export interface LandmarkCamera {
  zoom: number;
  size: { w: number; h: number };
  /** The map's own projection for the camera the layer is drawn for. */
  project: (p: GeoPoint) => { x: number; y: number };
  lite: boolean;
  /** Our pins, the courier, the centre pin: nothing of a landmark may touch their box. */
  obstacles: readonly LabelObstacle[];
  /** Other words already on the map (the zone names): landmarks keep off them too. */
  blocked?: readonly ScreenRect[];
  /** This map's name threshold (default `LANDMARK_RULES.nameZoom`; the partner job map uses `driverNameZoom`). */
  nameZoom?: number;
}

/** The first zoom landmarks show at. */
export function landmarkMinZoom(lite: boolean): number {
  return lite ? LANDMARK_RULES.liteMinZoom : LANDMARK_RULES.minZoom;
}

/** Whether this zoom shows landmarks at all (a layer can skip its work below it). */
export function landmarksVisible(zoom: number, lite: boolean): boolean {
  return zoom >= landmarkMinZoom(lite);
}

/** Whether names are drawn under the badges at this zoom (`nameZoom`: a map's own threshold). Never in lite mode. */
export function landmarkNamesVisible(zoom: number, lite: boolean, nameZoom: number = LANDMARK_RULES.nameZoom): boolean {
  return !lite && zoom >= nameZoom;
}

/** The box a marker keeps clear of landmarks: around and above its anchor (pins rise), a little under. */
export function markerKeepOut(m: ScreenMarker): ScreenRect {
  const half = m.halfW ?? LANDMARK_RULES.markerHalfW;
  const up = Math.max(m.up ?? 0, LANDMARK_RULES.markerUp);
  return { left: m.x - half, right: m.x + half, top: m.y - up, bottom: m.y + LANDMARK_RULES.markerDown };
}

/** The badge's box, centred on its point. */
export function landmarkIconRect(x: number, y: number): ScreenRect {
  const r = LANDMARK_RULES.iconPx / 2;
  return { left: x - r, right: x + r, top: y - r, bottom: y + r };
}

/** The name's box, centred under the badge. */
export function landmarkNameRect(x: number, y: number, name: string): ScreenRect {
  const half = textWidth(name, LANDMARK_RULES.nameFontPx) / 2;
  const top = y + LANDMARK_RULES.iconPx / 2 + LANDMARK_RULES.nameGapPx;
  return { left: x - half, right: x + half, top, bottom: top + LANDMARK_RULES.nameFontPx * 1.3 };
}

/**
 * The landmarks to draw on one camera, collision-free, in drawing order. Greedy by `LANDMARK_PRIORITY`,
 * then nearest the middle of the screen (where people look), then id (stable): a badge that would touch
 * a marker's keep-out box, a blocked word, the screen's edge or a landmark already placed is left out; a
 * name that would is left out alone, the badge stays. Below the zoom, nothing; in lite mode, fewer and
 * no names. Pure: the apps draw it, the Console uses the same zoom rules.
 */
export function placeLandmarks(items: readonly LandmarkPoint[], view: LandmarkCamera): PlacedLandmark[] {
  if (!landmarksVisible(view.zoom, view.lite) || view.size.w <= 0 || view.size.h <= 0) return [];
  const names = landmarkNamesVisible(view.zoom, view.lite, view.nameZoom);
  const cap = view.lite ? LANDMARK_RULES.liteMax : LANDMARK_RULES.max;
  const pad = LANDMARK_RULES.spacingPx;
  const cx = view.size.w / 2;
  const cy = view.size.h / 2;
  const hard: ScreenRect[] = [...obstaclesOnScreen(view.obstacles, view.size, view.project).map(markerKeepOut), ...(view.blocked ?? [])];
  const taken: ScreenRect[] = [];
  const onScreen = (r: ScreenRect) => r.left >= 0 && r.top >= 0 && r.right <= view.size.w && r.bottom <= view.size.h;
  const clear = (r: ScreenRect) => onScreen(r) && !hard.some((h) => rectsOverlap(r, h)) && !taken.some((t) => rectsOverlap(r, t, pad));

  const candidates = items
    .map((l) => ({ l, at: view.project(l.pin) }))
    .filter(({ at }) => at.x >= 0 && at.x <= view.size.w && at.y >= 0 && at.y <= view.size.h)
    .sort((a, b) => LANDMARK_PRIORITY[b.l.category] - LANDMARK_PRIORITY[a.l.category] || Math.hypot(a.at.x - cx, a.at.y - cy) - Math.hypot(b.at.x - cx, b.at.y - cy) || a.l.id.localeCompare(b.l.id));

  const out: PlacedLandmark[] = [];
  for (const { l, at } of candidates) {
    if (out.length >= cap) break;
    const icon = landmarkIconRect(at.x, at.y);
    if (!clear(icon)) continue;
    // The name is checked before its own badge is taken (it sits right under it by design).
    const box = names && l.name_ar ? landmarkNameRect(at.x, at.y, l.name_ar) : null;
    const name = box && clear(box) ? l.name_ar : null;
    taken.push(icon);
    if (box && name) taken.push(box);
    out.push({ id: l.id, category: l.category, x: at.x, y: at.y, name });
  }
  return out;
}

/** What a phone keeps of the landmark feed: the list and the etag it came with (null: ask for all). */
export interface LandmarkFeedCache {
  etag: string | null;
  landmarks: LandmarkFeedItem[];
}

export const EMPTY_LANDMARK_FEED: LandmarkFeedCache = { etag: null, landmarks: [] };

/**
 * The phone's copy after an answer: a full feed replaces it; "unchanged" keeps the list. An
 * "unchanged" with nothing kept (should not happen: the etag came from a list) drops the etag, so the
 * next ask gets everything.
 */
export function mergeLandmarkFeed(prev: LandmarkFeedCache | undefined, res: LandmarkFeed): LandmarkFeedCache {
  if (res.changed) return { etag: res.etag, landmarks: res.landmarks };
  if (prev && prev.etag === res.etag) return prev;
  return EMPTY_LANDMARK_FEED;
}
