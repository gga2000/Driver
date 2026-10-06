import { AZIZIYAH_ZONES } from '@driver/contracts';

/**
 * «هلا بيك بحيّك» (joy h7, discovery D-15 and idea 4-5): after setup, once, a small drawing of
 * Aziziyah with a pin dropping on the person's zone. The drawing is the J4 `welcome` scene (320 × 200
 * units: sky, the market, the town wall from y = 104, the Tigris at y ≈ 144); this maps a zone to a spot
 * on the town's ground band so the pin lands roughly where the zone is — east to the right, north up.
 */
export const SCENE_W = 320;
export const SCENE_H = 200;
/** The ground band the pin may land on (scene units), inside the arch and above the river. */
const BAND = { x0: 48, x1: 272, y0: 112, y1: 136 } as const;

const lats = AZIZIYAH_ZONES.map((z) => z.lat);
const lngs = AZIZIYAH_ZONES.map((z) => z.lng);
const LAT = { min: Math.min(...lats), max: Math.max(...lats) };
const LNG = { min: Math.min(...lngs), max: Math.max(...lngs) };

/** Where the pin lands, as fractions of the scene (0–1), or the town centre for an unknown zone. */
export function pinSpot(zoneId: string | null): { x: number; y: number } {
  const z = AZIZIYAH_ZONES.find((x) => x.id === zoneId) ?? AZIZIYAH_ZONES.find((x) => x.id === 'centre')!;
  const fx = (z.lng - LNG.min) / (LNG.max - LNG.min || 1);
  const fy = (LAT.max - z.lat) / (LAT.max - LAT.min || 1);
  const x = BAND.x0 + fx * (BAND.x1 - BAND.x0);
  const y = BAND.y0 + fy * (BAND.y1 - BAND.y0);
  return { x: x / SCENE_W, y: y / SCENE_H };
}

export type WelcomeHomeLine = 'home.welcome_hello' | 'home.welcome_hello_anon' | 'home.welcome_zone' | 'home.welcome_town';

/** The two lines: «هلا بيك أم علي» / «هلا بيك», then «هذا حيّك: شارع 30» or, without a place, «هذي العزيزية». */
export function welcomeLines(name: string | null, zoneId: string | null): [WelcomeHomeLine, WelcomeHomeLine] {
  return [name ? 'home.welcome_hello' : 'home.welcome_hello_anon', zoneId ? 'home.welcome_zone' : 'home.welcome_town'];
}

/** How long the pin takes to land before the success buzz (the spring settles around here). */
export const PIN_LAND_MS = 450;
