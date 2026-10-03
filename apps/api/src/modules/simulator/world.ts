import { AZIZIYAH_ZONES, type AziziyahZoneSeed, type CommissionTier, type LatLng, type RoleKind } from '@driver/contracts';
import { haversineMeters } from '../trips/index.js';
import { createRand, type Rand } from './prng.js';

/**
 * The simulated Aziziyah (plan Step 7): restaurants, couriers/drivers and customers placed on the
 * 34 seed zones. Deterministic from the seed: same seed, same world, pin for pin.
 *
 * Every pin is a zone centroid plus jitter, re-drawn until it resolves back to its own zone with the
 * same rule dispatch uses (`ZoneDirectory.zoneAt`: nearest centroid minus the draft radius), so a
 * pin never silently lands in a neighbour's tier and price band.
 */

export type SimVehicle = 'bike' | 'tuktuk' | 'car';

/**
 * The roles a simulated driver is registered with: bikes are couriers, tuktuks drive tuktuk rides and
 * deliver, cars drive taxi rides and deliver (launch playbook: car owners take food runs too). Dispatch
 * offers each one only what these roles allow on his vehicle (review 2026-10-04 #20).
 */
export function simDriverRoles(vehicle: SimVehicle): RoleKind[] {
  return vehicle === 'bike' ? ['courier'] : ['driver', 'courier'];
}

/** Moving speed by vehicle (km/h): bike 25, tuktuk 30, car 35 (plan Step 7). */
export const VEHICLE_SPEED_KMH: Readonly<Record<SimVehicle, number>> = { bike: 25, tuktuk: 30, car: 35 };

/** Launch supply mix (launch playbook): 10 bikes, 25 tuktuks, 25 cars out of 60. */
export const LAUNCH_SUPPLY: Readonly<Record<SimVehicle, number>> = { bike: 10, tuktuk: 25, car: 25 };

export interface MenuItem {
  id: string;
  name_ar: string;
  priceIqd: number;
}

export interface SimRestaurant {
  key: string;
  name_ar: string;
  zoneId: string;
  pin: LatLng;
  commissionTier: CommissionTier;
  autoAccept: boolean;
  defaultPrepMin: number;
  menu: MenuItem[];
}

export interface SimDriver {
  key: string;
  phone: string;
  vehicle: SimVehicle;
  tier: 'bronze' | 'silver' | 'gold';
  home: LatLng;
  zoneId: string;
  /** Minutes after the simulated day opens that he goes online / plans to log off. */
  shiftStartMin: number;
  shiftEndMin: number;
  /** Tuktuks opted in to edge-zone jobs (review: edge zones are opt-in for tuktuks). */
  edgeOptIn: boolean;
}

export interface SimCustomer {
  key: string;
  phone: string;
  home: LatLng;
  zoneId: string;
}

export interface World {
  seed: number;
  restaurants: SimRestaurant[];
  drivers: SimDriver[];
  customers: SimCustomer[];
}

export interface WorldOptions {
  seed: number;
  drivers?: number;
  restaurants?: number;
  customers?: number;
  /** Length of the simulated service day in minutes (shifts are placed inside it). */
  dayMinutes?: number;
}

const ZONES = new Map(AZIZIYAH_ZONES.map((z) => [z.id, z]));

/** The zone a position resolves to: nearest centroid minus its draft radius (dispatch's rule). */
export function zoneAt(at: LatLng): string {
  let best: { id: string; d: number } | null = null;
  for (const z of AZIZIYAH_ZONES) {
    const d = haversineMeters(at, { lat: z.lat, lng: z.lng }) - z.radiusM;
    if (!best || d < best.d) best = { id: z.id, d };
  }
  return best!.id;
}

export function zoneCentre(zoneId: string): LatLng {
  const z = ZONES.get(zoneId);
  if (!z) throw new Error(`unknown zone ${zoneId}`);
  return { lat: z.lat, lng: z.lng };
}

export function zoneSeed(zoneId: string): AziziyahZoneSeed {
  const z = ZONES.get(zoneId);
  if (!z) throw new Error(`unknown zone ${zoneId}`);
  return z;
}

/** Moves `from` by `northM` metres north and `eastM` metres east (small distances). */
export function offset(from: LatLng, northM: number, eastM: number): LatLng {
  const dLat = northM / 111_320;
  const dLng = eastM / (111_320 * Math.cos((from.lat * Math.PI) / 180));
  return { lat: round6(from.lat + dLat), lng: round6(from.lng + dLng) };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** A pin inside `zoneId`: its centroid jittered within 60 % of the draft radius, re-drawn until it resolves to the zone. */
export function pinIn(zoneId: string, rand: Rand): LatLng {
  const z = zoneSeed(zoneId);
  const centre = { lat: z.lat, lng: z.lng };
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const r = Math.sqrt(rand.next()) * z.radiusM * 0.6;
    const a = rand.next() * 2 * Math.PI;
    const p = offset(centre, r * Math.cos(a), r * Math.sin(a));
    if (zoneAt(p) === zoneId) return p;
  }
  return centre;
}

/** Where people live and order from: more in the centre, fewer at the edge. */
const DEMAND_WEIGHT: Readonly<Record<AziziyahZoneSeed['tier'], number>> = { centre: 6, near: 4, mid: 2.5, far: 1.2, edge: 0.5 };
/** Where restaurants sit: the centre and the near ring, a few further out. */
const RESTAURANT_WEIGHT: Readonly<Record<AziziyahZoneSeed['tier'], number>> = { centre: 8, near: 4, mid: 1.5, far: 0.4, edge: 0 };

const DISHES: ReadonlyArray<[string, number, number]> = [
  ['كباب', 4000, 9000],
  ['تكة', 4000, 8500],
  ['شاورما', 1500, 4000],
  ['فلافل', 1000, 2500],
  ['بيتزا', 5000, 12000],
  ['برگر', 3000, 7000],
  ['دولمة', 5000, 10000],
  ['قوزي', 8000, 15000],
  ['سمك مسگوف', 10000, 18000],
  ['مشويات مشكلة', 9000, 16000],
  ['عصير', 1000, 2500],
  ['سلطة', 1000, 2000],
];
const RESTAURANT_NAMES = ['مطعم الريف', 'مطعم دجلة', 'مطعم الزهراء', 'مطعم السلطان', 'مطعم البيت العراقي', 'مطعم الكوثر', 'مطعم أبو علي', 'مطعم الواحة', 'مطعم النخيل', 'مطعم الفرات'];
const TIERS: readonly CommissionTier[] = ['base', 'featured', 'featured', 'marketing', 'base'];

/** Rounds to the 500-IQD price step menus use (G-88: customer totals in multiples of 500). */
const price500 = (n: number) => Math.max(500, Math.round(n / 500) * 500);

/** Splits `n` drivers into bikes / tuktuks / cars in the launch proportions (largest remainder). */
export function supplyMix(n: number): Record<SimVehicle, number> {
  const total = LAUNCH_SUPPLY.bike + LAUNCH_SUPPLY.tuktuk + LAUNCH_SUPPLY.car;
  const kinds: SimVehicle[] = ['bike', 'tuktuk', 'car'];
  const raw = kinds.map((k) => (n * LAUNCH_SUPPLY[k]) / total);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] = out[i]! + 1;
    left -= 1;
  }
  return { bike: out[0]!, tuktuk: out[1]!, car: out[2]! };
}

export function buildWorld(opts: WorldOptions): World {
  const seed = opts.seed;
  const rand = createRand(seed).fork('world');
  const dayMinutes = opts.dayMinutes ?? 14 * 60;
  const nRestaurants = opts.restaurants ?? 10;
  const nDrivers = opts.drivers ?? 60;
  const nCustomers = opts.customers ?? 400;

  const restaurants: SimRestaurant[] = [];
  const rr = rand.fork('restaurants');
  for (let i = 0; i < nRestaurants; i += 1) {
    const zone = rr.weighted(AZIZIYAH_ZONES, (z) => RESTAURANT_WEIGHT[z.tier]);
    const dishes = DISHES.filter(() => rr.chance(0.7));
    const menu = (dishes.length >= 4 ? dishes : DISHES.slice(0, 6)).map(([name, lo, hi], j) => ({
      id: `r${i + 1}-item${j + 1}`,
      name_ar: name,
      priceIqd: price500(rr.range(lo, hi)),
    }));
    restaurants.push({
      key: `r${i + 1}`,
      name_ar: RESTAURANT_NAMES[i % RESTAURANT_NAMES.length]! + (i >= RESTAURANT_NAMES.length ? ` ${Math.floor(i / RESTAURANT_NAMES.length) + 1}` : ''),
      zoneId: zone.id,
      pin: pinIn(zone.id, rr),
      commissionTier: TIERS[i % TIERS.length]!,
      // One kitchen in ten runs on auto-accept (domain §2).
      autoAccept: i % 10 === 9,
      defaultPrepMin: rr.int(12, 20),
      menu,
    });
  }

  const drivers: SimDriver[] = [];
  const dr = rand.fork('drivers');
  const mix = supplyMix(nDrivers);
  const vehicles: SimVehicle[] = [...Array<SimVehicle>(mix.bike).fill('bike'), ...Array<SimVehicle>(mix.tuktuk).fill('tuktuk'), ...Array<SimVehicle>(mix.car).fill('car')];
  vehicles.forEach((vehicle, i) => {
    const zone = dr.weighted(AZIZIYAH_ZONES, (z) => DEMAND_WEIGHT[z.tier] + (z.tier === 'edge' ? 0 : 1));
    // Most start at opening; a third join for the lunch rush; everyone stays to close.
    const shiftStartMin = dr.chance(0.65) ? dr.int(0, 30) : dr.int(120, 200);
    drivers.push({
      key: `d${i + 1}`,
      phone: `0780${String(seed % 1000).padStart(3, '0')}${String(i + 1).padStart(4, '0')}`,
      vehicle,
      tier: dr.chance(0.15) ? 'silver' : 'bronze',
      home: pinIn(zone.id, dr),
      zoneId: zone.id,
      shiftStartMin,
      shiftEndMin: dayMinutes,
      edgeOptIn: vehicle === 'tuktuk' && dr.chance(0.3),
    });
  });

  const customers: SimCustomer[] = [];
  const cr = rand.fork('customers');
  for (let i = 0; i < nCustomers; i += 1) {
    const zone = cr.weighted(AZIZIYAH_ZONES, (z) => DEMAND_WEIGHT[z.tier]);
    customers.push({
      key: `c${i + 1}`,
      phone: `0770${String(seed % 1000).padStart(3, '0')}${String(i + 1).padStart(4, '0')}`,
      home: pinIn(zone.id, cr),
      zoneId: zone.id,
    });
  }

  return { seed, restaurants, drivers, customers };
}
