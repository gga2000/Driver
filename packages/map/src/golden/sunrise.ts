import type { GoldenLight } from './sun.js';
import type { LngLat } from './metres.js';

/**
 * "Sunrise over Aziziyah" (N4, Ali 2026-10-11): on the very first open, the camera rises from the Tigris over the town
 * while the light warms from dawn to morning («صباح الخير، هذي العزيزية»), then the sheet asks for the door on the day map.
 * About 8 s, played once; a tap skips to the end; with reduce motion only the last frame shows.
 */
export interface SunriseKeyframe {
  atMs: number;
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface SunriseTour {
  keyframes: SunriseKeyframe[];
  /** Rebuild the style at each step (night → morning → day); the last one is the day map the pin picker uses. */
  lights: { atMs: number; light: GoldenLight }[];
  totalMs: number;
}

/** The town centre and the Tigris bend south-west of it, where the tour starts low over the water looking towards the sunrise. */
const TOWN: LngLat = [45.06, 32.906];
const RIVER: LngLat = [45.046, 32.9];

export function sunriseTour(town: LngLat = TOWN): SunriseTour {
  const dx = town[0] - TOWN[0], dy = town[1] - TOWN[1];
  const river: LngLat = [RIVER[0] + dx, RIVER[1] + dy];
  return {
    keyframes: [
      { atMs: 0, center: river, zoom: 15.6, pitch: 72, bearing: 70 },
      { atMs: 3500, center: [(river[0] + town[0]) / 2, (river[1] + town[1]) / 2], zoom: 15.2, pitch: 64, bearing: 62 },
      { atMs: 8000, center: town, zoom: 14.6, pitch: 50, bearing: 50 },
    ],
    lights: [
      { atMs: 0, light: 'night' },
      { atMs: 2200, light: 'morning' },
      { atMs: 6400, light: 'day' },
    ],
    totalMs: 8000,
  };
}
