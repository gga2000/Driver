import { AZIZIYAH_ZONES } from '@driver/contracts';

/**
 * «الشمس تطلع على العزيزية» (map idea N4, Ali 2026-10-11): after sign-up, once, the camera rises from the
 * Tigris over the town while the light warms from dawn to morning, and lands over the person's own street.
 * The tour's shape is the map package's `sunriseTour` (M2); until it lands, `sunriseStandIn` draws the
 * same kind of path so the screen can be built and checked. Pure: the screen eases between keyframes.
 */

export type LngLat = [number, number];
/** The map's light steps (the Golden hour palettes). */
export type SunriseLight = 'day' | 'morning' | 'golden' | 'sunset' | 'night';

export interface SunriseCamera {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface SunriseTour {
  keyframes: (SunriseCamera & { atMs: number })[];
  lights: { atMs: number; light: SunriseLight }[];
  totalMs: number;
}

/** The town centre, where the camera lands without a zone. */
export const TOWN: LngLat = (() => {
  const c = AZIZIYAH_ZONES.find((z) => z.id === 'centre')!;
  return [c.lng, c.lat];
})();

/** Where the tour lands: the saved door, else the zone the person picked, else the town centre. */
export function sunriseLanding(pin: { lat: number; lng: number } | null | undefined, zoneId: string | null): LngLat {
  if (pin) return [pin.lng, pin.lat];
  const z = zoneId ? AZIZIYAH_ZONES.find((x) => x.id === zoneId) : undefined;
  return z ? [z.lng, z.lat] : TOWN;
}

/**
 * Until the map's own `sunriseTour` lands: low over the Tigris just south of the town at dawn, looking
 * across the water at the roofs; up over the town as the light turns golden; then down over the landing
 * street in the morning, turning a little. 8 s.
 */
export function sunriseStandIn(at: LngLat = TOWN): SunriseTour {
  const river: LngLat = [TOWN[0] - 0.002, TOWN[1] - 0.0085];
  const mid: LngLat = [(river[0] + at[0]) / 2, (river[1] + at[1]) / 2];
  return {
    keyframes: [
      { atMs: 0, center: river, zoom: 14.4, pitch: 62, bearing: -28 },
      { atMs: 4000, center: mid, zoom: 15.2, pitch: 56, bearing: -6 },
      { atMs: 8000, center: at, zoom: 16.4, pitch: 60, bearing: 18 },
    ],
    lights: [
      { atMs: 0, light: 'sunset' },
      { atMs: 2800, light: 'golden' },
      { atMs: 5600, light: 'morning' },
    ],
    totalMs: 8000,
  };
}

/** Ease in and out: slow off the river, quick over the town, slow onto the street. */
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const mix = (a: number, b: number, f: number) => a + (b - a) * f;

/** The camera `t` ms into the tour (held at the first keyframe before it, at the last after the end). */
export function sunriseCameraAt(tour: SunriseTour, t: number): SunriseCamera {
  const k = tour.keyframes;
  const first = k[0]!;
  const last = k[k.length - 1]!;
  if (t <= first.atMs) return pick(first);
  if (t >= last.atMs) return pick(last);
  const i = k.findIndex((f) => f.atMs > t);
  const a = k[i - 1]!;
  const b = k[i]!;
  const f = ease((t - a.atMs) / (b.atMs - a.atMs));
  return {
    center: [mix(a.center[0], b.center[0], f), mix(a.center[1], b.center[1], f)],
    zoom: mix(a.zoom, b.zoom, f),
    pitch: mix(a.pitch, b.pitch, f),
    bearing: mix(a.bearing, b.bearing, f),
  };
}

/** The light `t` ms into the tour: the last step that has started (the first one before any). */
export function sunriseLightAt(tour: SunriseTour, t: number): SunriseLight {
  let light = tour.lights[0]?.light ?? 'morning';
  for (const step of tour.lights) if (step.atMs <= t) light = step.light;
  return light;
}

/** Where the tour ends (what reduce motion and a skip jump to). */
export function sunriseEnd(tour: SunriseTour): { camera: SunriseCamera; light: SunriseLight } {
  return { camera: sunriseCameraAt(tour, tour.totalMs), light: sunriseLightAt(tour, tour.totalMs) };
}

const pick = ({ center, zoom, pitch, bearing }: SunriseCamera): SunriseCamera => ({ center: [center[0], center[1]], zoom, pitch, bearing });
