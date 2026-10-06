import type { DeliveryAreaZone, MerchantCustomerZones, MerchantDeliveryArea } from '@driver/contracts';
import { color } from '@driver/design-tokens';
import { fitProjection, SVG_FIT_PADDING_PX, type GeoPoint, type SvgProjection } from '@driver/map';

/**
 * «منطقة التوصيل» and «منين زبائنك» (maps program r5, r6), free of React Native so they are unit-tested:
 * which colour a fee band gets, the legend, the zone list, and the customers' ranking. Every amount
 * here is the server's; nothing is priced or rounded on the device.
 */

/**
 * Fee shading, cheapest → dearest: the brand orange ramp from a light wash to deep amber, so "more
 * expensive" reads as "darker" at a glance on a cream tablet. Starts at 200: 100 is too close to the
 * cream background to tell apart from an unpriced zone.
 */
export const FEE_RAMP: readonly string[] = [color.primary[200], color.primary[300], color.primary[400], color.primary[500], color.primary[600], color.primary[700]];

/** A zone with no fee (no place on file, or not priced): neutral, so it never looks like a cheap band. */
export const UNPRICED_FILL = color.neutral[200];
/** Inner fill of a switched-off zone, under a dashed border. */
export const PAUSED_FILL = color.neutral[300];

/**
 * The ramp colour for band `band` of `count`: spread across the whole ramp so two bands are light and
 * dark rather than two neighbouring oranges; one band sits in the middle.
 */
export function bandColor(band: number, count: number): string {
  const last = FEE_RAMP.length - 1;
  if (count <= 1) return FEE_RAMP[Math.floor(last / 2)]!;
  const i = Math.round((Math.min(band, count - 1) * last) / (count - 1));
  return FEE_RAMP[Math.max(0, Math.min(last, i))]!;
}

export interface ZoneShade {
  fill: string;
  /** Dashed border: the zone is switched off for now. */
  dashed: boolean;
}

/** How a zone is painted on the fee map. */
export function feeShade(zone: Pick<DeliveryAreaZone, 'band' | 'service'>, bandCount: number): ZoneShade {
  if (zone.service === 'paused') return { fill: PAUSED_FILL, dashed: true };
  if (zone.band === null) return { fill: UNPRICED_FILL, dashed: false };
  return { fill: bandColor(zone.band, bandCount), dashed: false };
}

export interface LegendRow {
  feeIqd: number;
  zones: number;
  color: string;
}

/** The legend: one row per fee the server quoted, cheapest first, in the map's colours. */
export function legendRows(area: Pick<MerchantDeliveryArea, 'bands'>): LegendRow[] {
  return area.bands.map((b, i) => ({ feeIqd: b.feeIqd, zones: b.zones, color: bandColor(i, area.bands.length) }));
}

/** Zones switched off right now (the legend's extra line). */
export function pausedCount(zones: readonly Pick<DeliveryAreaZone, 'service'>[]): number {
  return zones.filter((z) => z.service === 'paused').length;
}

/** The zone's name in the app's language. */
export function zoneName(zone: { name_ar: string; name_en: string }, locale: 'ar-IQ' | 'en'): string {
  return locale === 'en' ? zone.name_en : zone.name_ar;
}

/**
 * The list beside the map: the kitchen's own zone first, then by fee (cheapest first), then by name;
 * unpriced zones last. The same order as the legend, so reading down the list walks the colours.
 */
export function zoneRows<T extends Pick<DeliveryAreaZone, 'feeIqd' | 'kitchen' | 'name_ar'>>(zones: readonly T[]): T[] {
  const rank = (z: T) => (z.kitchen ? -1 : (z.feeIqd ?? Number.MAX_SAFE_INTEGER));
  return [...zones].sort((a, b) => rank(a) - rank(b) || a.name_ar.localeCompare(b.name_ar, 'ar'));
}

/** The zone the detail card shows: the one tapped, else the kitchen's own, else none. */
export function selectedZone<T extends Pick<DeliveryAreaZone, 'key' | 'kitchen'>>(zones: readonly T[], key: string | null): T | null {
  return (key ? zones.find((z) => z.key === key) : undefined) ?? zones.find((z) => z.kitchen) ?? null;
}

/** Every point the map must fit: the zones' outlines (or centres without one) and the kitchen. */
export function mapPoints(
  zones: ReadonlyArray<{ ring: ReadonlyArray<{ lat: number; lng: number }>; centre: { lat: number; lng: number } }>,
  kitchen: { lat: number; lng: number } | null,
): Array<{ lat: number; lng: number }> {
  const pts = zones.flatMap((z) => (z.ring.length >= MIN_RING_POINTS ? z.ring : [z.centre]));
  return kitchen ? [...pts, kitchen] : pts;
}

/** A ring with fewer points is not an outline: the map draws a dot at the zone's centre instead. */
export const MIN_RING_POINTS = 3;

/** The zones' own shape: no panel-shaped aspect limits, so the frame hugs the outer zones. */
const HUG = { minAspect: 0, maxAspect: Number.POSITIVE_INFINITY } as const;

/**
 * The zone map's box and projection. The box takes the zones' real shape (north up, to scale) with
 * only the fit padding around the outer zones — no empty bands beside a town stretched along the
 * river — and is as wide as the panel unless that would make it taller than `maxHeight`; then it is
 * narrower (the screen centres it), so the whole town and the hint under it stay on one screen.
 */
export function fitZoneMap(points: readonly GeoPoint[], maxWidth: number, maxHeight?: number): SvgProjection {
  const pad = SVG_FIT_PADDING_PX;
  if (points.length === 0) return fitProjection(points, maxWidth);
  const full = fitProjection(points, maxWidth, HUG);
  if (maxHeight === undefined || full.height <= maxHeight || maxWidth <= 2 * pad) return full;
  // Height ÷ width of the drawing; one px of slack absorbs fitProjection's rounding of the height.
  const aspect = (full.height - 2 * pad) / (maxWidth - 2 * pad);
  const inner = Math.max(1, Math.floor((maxHeight - 2 * pad - 1) / aspect));
  return fitProjection(points, inner + 2 * pad, HUG);
}

// ───────────────────────── where my customers are ─────────────────────────

export interface CustomerRow {
  key: string;
  name_ar: string;
  name_en: string;
  orders: number;
  /** Share of all delivered orders in the window, 0–1. */
  share: number;
  /** 1–4 against the busiest zone: the map's shade. */
  level: 1 | 2 | 3 | 4;
}

/** Heat scale for customers per zone: the brand ramp the peak-hours heatmap uses (level 0 = not shown). */
export const CUSTOMER_HEAT: readonly string[] = [UNPRICED_FILL, color.primary[100], color.primary[300], color.primary[500], color.primary[700]];

/** Level 1–4 of a zone against the busiest one (quartiles, like the peak-hours heatmap). */
export function customerLevel(orders: number, max: number): 1 | 2 | 3 | 4 {
  const r = max > 0 ? orders / max : 0;
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

/**
 * The ranked list: the server's named zones (already ≥ 5 orders, most first) with their share of every
 * delivered order — "other" included in the total, so the shares are honest — and their map shade.
 */
export function customerRows(data: Pick<MerchantCustomerZones, 'zones' | 'totalOrders'>): CustomerRow[] {
  const max = data.zones.reduce((m, z) => Math.max(m, z.orders), 0);
  return [...data.zones]
    .sort((a, b) => b.orders - a.orders || a.name_ar.localeCompare(b.name_ar, 'ar'))
    .map((z) => ({ ...z, share: data.totalOrders > 0 ? z.orders / data.totalOrders : 0, level: customerLevel(z.orders, max) }));
}

/** Map fill per zone key for the customers' map; zones not named stay neutral. */
export function customerFills(rows: readonly CustomerRow[]): Map<string, string> {
  return new Map(rows.map((r) => [r.key, CUSTOMER_HEAT[r.level]!]));
}

/** Whole percent for a share ("38%"); under 1% but above zero reads "1%" so a named zone never shows 0. */
export function sharePercent(share: number): number {
  if (share <= 0) return 0;
  return Math.max(1, Math.round(share * 100));
}
