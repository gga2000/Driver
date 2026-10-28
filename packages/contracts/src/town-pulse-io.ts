import { z } from 'zod';
import { LatLng } from './common.js';
import { haversineM } from './travel.js';

/**
 * «المدينة حيّة», the live map home of the Partner app (Ali, 2026-10-22: A + C with a soft B). The town
 * as a driver may see it: kitchens near him that are cooking or have food ready, how many new orders each
 * area got a few minutes ago, how many drivers are around in each part of town, and his own day.
 *
 * Privacy (lane A's rules for this feed): no home-cook kitchen and no cart; no order ids, customer pins or
 * per-kitchen order counts; areas and driver cells show only with `minCount` or more, a few minutes late;
 * other drivers are a count per cell, never a dot, an id or a heading. One picture per city is built at most
 * every `snapshotMs` and every driver reads that same picture, cut to the part of town around him.
 */
export const TOWN_PULSE_RULES = {
  /** One picture per city this often; the app reads it at the same pace while he is online. */
  snapshotMs: 20_000,
  /** Kitchens and driver cells within this of him. */
  radiusKm: 2.5,
  /** At most this many kitchens (nearest first) and driver cells. */
  maxKitchens: 12,
  maxCells: 8,
  /** New orders count from this long ago … */
  ordersDelayMs: 3 * 60_000,
  /** … back over this window. */
  ordersWindowMs: 10 * 60_000,
  /** An area or a driver cell shows only with at least this many. */
  minCount: 3,
  /** Driver positions are this old at least (the presence picture taken one snapshot earlier). */
  driversDelayMs: 60_000,
  /** Driver cells: a grid this big in degrees (about 330 m × 280 m in Aziziyah). */
  cellDeg: 0.003,
  /** The kitchen's ring moves in quarter steps only. */
  progressSteps: 4,
} as const;

export const TownKitchen = z.object({
  /** The shop's id (shops are public places); never an order's. */
  id: z.string(),
  at: LatLng,
  /** «يطبخ»: at least one order accepted or cooking; «جاهز»: food waiting for its driver. */
  state: z.enum(['cooking', 'ready']),
  /** How far the soonest cooking order is, in quarter steps (0, .25, .5, .75); null when ready or unknown. */
  progress: z.number().min(0).max(1).nullable(),
});
export type TownKitchen = z.infer<typeof TownKitchen>;

export const PartnerTownPulse = z.object({
  /** When the picture was taken. */
  at: z.coerce.date(),
  kitchens: z.array(TownKitchen),
  /** New orders per area over the window (only areas with `minCount` or more). */
  areas: z.array(z.object({ zoneId: z.string(), n: z.number().int().min(1) })),
  /** Online drivers per grid cell, centre of the cell (only cells with `minCount` or more, never him alone). */
  drivers: z.array(z.object({ at: LatLng, n: z.number().int().min(1) })),
});
export type PartnerTownPulse = z.infer<typeof PartnerTownPulse>;

/**
 * «العزيزية هسة», the customer's live map (Ali, 2026-10-28: A + the minutes chip + the shop tour once): the
 * same city picture, cut for a customer. Kitchens near their place that are cooking (ready counts as
 * cooking: a customer only needs «يطبخ هسة»), and how many drivers are in each part of town. No areas, no
 * progress, no order ids or counts, no driver dots; driver cells keep the 3-or-more rule and the minute's delay.
 */
export const CustomerTownNowInput = z.object({ at: LatLng });
export type CustomerTownNowInput = z.infer<typeof CustomerTownNowInput>;

export const CustomerTownNow = z.object({
  /** When the picture was taken. */
  at: z.coerce.date(),
  /** Shops cooking now within `radiusKm` of the place, nearest first. */
  cooking: z.array(z.object({ id: z.string(), at: LatLng })),
  /** Drivers per grid cell (cell centre), only cells with `minCount` or more, nearest first. */
  drivers: z.array(z.object({ at: LatLng, n: z.number().int().min(1) })),
});
export type CustomerTownNow = z.infer<typeof CustomerTownNow>;

/** A customer's cut of the city picture around their place (pure). */
export function townNowFor(snap: TownPulseSnapshot, at: LatLng): CustomerTownNow {
  const R = TOWN_PULSE_RULES;
  const dist = (p: LatLng) => haversineM(at, p);
  const near = (p: LatLng) => dist(p) <= R.radiusKm * 1000;
  const cooking = snap.kitchens
    .filter((k) => near(k.at))
    .sort((a, b) => dist(a.at) - dist(b.at) || a.id.localeCompare(b.id))
    .slice(0, R.maxKitchens)
    .map((k) => ({ id: k.id, at: k.at }));
  const drivers = snap.cells
    .map((c) => ({ at: c.at, n: c.driverIds.length }))
    .filter((c) => c.n >= R.minCount && near(c.at))
    .sort((a, b) => dist(a.at) - dist(b.at))
    .slice(0, R.maxCells);
  return { at: snap.at, cooking, drivers };
}

/** «يومي»: his own deliveries today, with what each one earned (the same lines the earnings screen adds up). */
export const PartnerMyDay = z.object({
  jobs: z.array(
    z.object({
      tripId: z.string(),
      pickup: LatLng.nullable(),
      dropoff: LatLng.nullable(),
      doneAt: z.coerce.date(),
      earnedIqd: z.number().int(),
    }),
  ),
  earningsIqd: z.number().int(),
});
export type PartnerMyDay = z.infer<typeof PartnerMyDay>;

/** What the server feeds the picture with (all from the city's own records, no personal data). */
export interface TownPulseInput {
  at: Date;
  kitchens: ReadonlyArray<{ merchantOrgId: string; pin: LatLng | null; state: 'merchant_accepted' | 'preparing' | 'ready'; acceptedAt: Date | null; promisedReadyAt: Date | null }>;
  /** Orders placed in the city with their drop-off area (any state), oldest first or not. */
  placed: ReadonlyArray<{ zoneId: string | null; placedAt: Date }>;
  /** Online drivers from the previous picture (so positions are a snapshot old). */
  drivers: ReadonlyArray<{ driverId: string; lat: number; lng: number }>;
}

/** One city's picture: every kitchen, every lit area, and the drivers in cells (with who is in each, to leave him out). */
export interface TownPulseSnapshot {
  at: Date;
  kitchens: TownKitchen[];
  areas: Array<{ zoneId: string; n: number }>;
  cells: Array<{ at: LatLng; driverIds: readonly string[] }>;
}

function quarter(p: number): number {
  const steps = TOWN_PULSE_RULES.progressSteps;
  return Math.min(steps - 1, Math.max(0, Math.floor(p * steps))) / steps;
}

/** Builds the city's picture (pure: the server feeds it, tests check it). */
export function townPulseSnapshot(input: TownPulseInput): TownPulseSnapshot {
  const now = input.at.getTime();
  const R = TOWN_PULSE_RULES;
  const kitchens = new Map<string, TownKitchen>();
  for (const k of input.kitchens) {
    if (!k.pin) continue;
    const prev = kitchens.get(k.merchantOrgId);
    if (k.state === 'ready') {
      // Food waiting beats cooking: the bubble a driver can act on.
      kitchens.set(k.merchantOrgId, { id: k.merchantOrgId, at: k.pin, state: 'ready', progress: null });
      continue;
    }
    if (prev?.state === 'ready') continue;
    const span = k.acceptedAt && k.promisedReadyAt ? k.promisedReadyAt.getTime() - k.acceptedAt.getTime() : 0;
    const p = span > 0 && k.acceptedAt ? quarter((now - k.acceptedAt.getTime()) / span) : null;
    // The soonest-done order sets the ring.
    const progress = prev?.progress == null ? p : p == null ? prev.progress : Math.max(prev.progress, p);
    kitchens.set(k.merchantOrgId, { id: k.merchantOrgId, at: k.pin, state: 'cooking', progress });
  }
  const from = now - R.ordersDelayMs - R.ordersWindowMs;
  const to = now - R.ordersDelayMs;
  const perZone = new Map<string, number>();
  for (const o of input.placed) {
    const t = o.placedAt.getTime();
    if (!o.zoneId || t < from || t > to) continue;
    perZone.set(o.zoneId, (perZone.get(o.zoneId) ?? 0) + 1);
  }
  const areas = [...perZone].filter(([, n]) => n >= R.minCount).map(([zoneId, n]) => ({ zoneId, n })).sort((a, b) => b.n - a.n || a.zoneId.localeCompare(b.zoneId));
  const cells = new Map<string, { at: LatLng; driverIds: string[] }>();
  for (const d of input.drivers) {
    const cx = Math.floor(d.lng / R.cellDeg);
    const cy = Math.floor(d.lat / R.cellDeg);
    const key = `${cx}:${cy}`;
    const cell = cells.get(key) ?? { at: { lat: (cy + 0.5) * R.cellDeg, lng: (cx + 0.5) * R.cellDeg }, driverIds: [] };
    cell.driverIds.push(d.driverId);
    cells.set(key, cell);
  }
  return { at: input.at, kitchens: [...kitchens.values()], areas, cells: [...cells.values()] };
}

/** One driver's cut of the city picture: what is around him, and never a cell he alone would make count. */
export function townPulseFor(snap: TownPulseSnapshot, me: { driverId: string; at: LatLng | null }): PartnerTownPulse {
  const R = TOWN_PULSE_RULES;
  const near = (at: LatLng) => !me.at || haversineM(me.at, at) <= R.radiusKm * 1000;
  const dist = (at: LatLng) => (me.at ? haversineM(me.at, at) : 0);
  const kitchens = snap.kitchens
    .filter((k) => near(k.at))
    .sort((a, b) => dist(a.at) - dist(b.at) || a.id.localeCompare(b.id))
    .slice(0, R.maxKitchens);
  const drivers = snap.cells
    .map((c) => ({ at: c.at, n: c.driverIds.filter((id) => id !== me.driverId).length }))
    .filter((c) => c.n >= R.minCount && near(c.at))
    .sort((a, b) => dist(a.at) - dist(b.at))
    .slice(0, R.maxCells);
  return { at: snap.at, kitchens, areas: snap.areas, drivers };
}
