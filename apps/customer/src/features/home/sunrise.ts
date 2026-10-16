import { AZIZIYAH_ZONES } from '@driver/contracts';
import type { GoldenLight } from '@driver/map/golden';
import type { SunriseKeyframe, SunriseTour } from '@driver/map/pieces/sunrise';

/**
 * «الشمس تطلع على العزيزية» (map idea N4, Ali 2026-10-11): after sign-up, once, the camera rises from the
 * Tigris over the town while the light warms from night to day, and lands over the person's own place.
 * The tour itself is the map package's `sunriseTour` (its keyframes and light steps); this file says
 * where it lands and eases the camera between its keyframes: frame by frame on the web, as moves the map
 * eases itself on phones. Pure.
 */

export type LngLat = [number, number];
export type SunriseCamera = Omit<SunriseKeyframe, 'atMs'>;

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

/** Ease in and out: slow off the river, quick over the town, slow onto the landing. */
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

/** One camera move of the tour for a map that eases on its own (the phones): it starts `atMs` into the tour and takes `durationMs`. */
export interface SunriseLeg {
  atMs: number;
  durationMs: number;
  to: SunriseCamera;
}

/** The tour as one move per keyframe after the first, each eased in and out as `sunriseCameraAt` does (the phones hand each to the map). */
export function sunriseLegs(tour: SunriseTour): SunriseLeg[] {
  return tour.keyframes.slice(1).map((b, i) => {
    const a = tour.keyframes[i]!;
    return { atMs: a.atMs, durationMs: b.atMs - a.atMs, to: pick(b) };
  });
}

/** The light `t` ms into the tour: the last step that has started (the first one before any). */
export function sunriseLightAt(tour: SunriseTour, t: number): GoldenLight {
  let light = tour.lights[0]?.light ?? 'day';
  for (const step of tour.lights) if (step.atMs <= t) light = step.light;
  return light;
}

/** Where the tour ends (what reduce motion and a skip jump to). */
export function sunriseEnd(tour: SunriseTour): { camera: SunriseCamera; light: GoldenLight } {
  return { camera: sunriseCameraAt(tour, tour.totalMs), light: sunriseLightAt(tour, tour.totalMs) };
}

const pick = ({ center, zoom, pitch, bearing }: SunriseCamera): SunriseCamera => ({ center: [center[0], center[1]], zoom, pitch, bearing });
