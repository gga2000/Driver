import type {
  CityPricingConfig,
  ComponentKey,
  ComponentRule,
  PriceRequest,
  Quote,
  QuoteComponent,
  VerticalPricing,
  ZoneTier,
} from '@driver/contracts';

/**
 * Pure pricing engine (spec §7). No I/O, no clock: everything comes from the request
 * and the city config, so the same inputs always produce the same quote.
 *
 * A quote is the sum of named, explained components. Zone tables give the base per leg;
 * distance and time are always computed as shadow components and hidden until config
 * flips their visibility. Totals are rounded per city and clamped per vertical.
 */
export class PricingEngine {
  constructor(private readonly idFactory: () => string = defaultId) {}

  quote(req: PriceRequest, city: CityPricingConfig): Quote {
    if (req.cityId !== city.cityId) {
      throw new PricingError('city_mismatch', `request city ${req.cityId} != config ${city.cityId}`);
    }
    const vertical = city.verticals.find((v) => v.vertical === req.vertical);
    if (!vertical) {
      throw new PricingError('vertical_not_configured', `${req.vertical} not configured for ${city.cityId}`);
    }

    const rules = indexRules(vertical.components);
    const legs = legsOf(req);
    const components: QuoteComponent[] = [];

    // 1. Zone base — one component per leg so multi-stop trips are priced per leg.
    const tiers = tierIndex(city);
    legs.forEach((leg, i) => {
      components.push(
        component(rules, 'base', zoneFare(vertical, leg.from, leg.to, tiers), {
          leg: i,
          fallback: { label_ar: 'السعر الأساسي', label_en: 'Base fare', driverShareRule: 'driver_commissioned' },
        }),
      );
    });

    // 2. Shadow metered components — always computed, hidden until enabled.
    const distanceRule = rules.get('distance');
    const timeRule = rules.get('time');
    components.push(
      metered('distance', req.distanceKm ?? 0, distanceRule, 'المسافة', 'Distance'),
      metered('time', req.durationMin ?? 0, timeRule, 'الوقت', 'Time'),
    );

    // 3. Option-driven flat components.
    const { frontSeat, doorPickup, streetHandover, waitMinutes, promoIqd } = req.options;
    if (frontSeat) components.push(flat(rules, 'front_seat', 'مقعد أمامي', 'Front seat'));
    // Deliveries default to the door (street handover is an opt-in discount); rides default to the
    // street (door pickup is an opt-in fee). The vertical's rule set decides which world we are in.
    const deliveryLike = (rules.get('street_pickup')?.amount ?? 0) < 0;
    const atDoor = deliveryLike ? !streetHandover || doorPickup : doorPickup;
    components.push(
      atDoor
        ? flat(rules, 'door_pickup', 'نجيك للباب', 'Door pickup')
        : flat(rules, 'street_pickup', 'تلاقينا بالشارع', 'Street pickup'),
    );
    if (waitMinutes > 0) {
      components.push(metered('wait', waitMinutes, rules.get('wait'), 'انتظار', 'Waiting'));
    }

    // 3b. Always-on flat fees the city configures (service fee; small-order fee is applied by orders).
    if (rules.get('service_fee')?.amount) components.push(flat(rules, 'service_fee', 'رسوم الخدمة', 'Service fee'));

    // 4. Time-gated components (night, peak) by local hour.
    const hour = localHour(req.at, city.timezone);
    for (const key of ['night', 'peak'] as const) {
      const rule = rules.get(key);
      if (rule?.hours && inWindow(hour, rule.hours)) {
        components.push(flat(rules, key, key === 'night' ? 'رسوم الليل' : 'رسوم الذروة', key === 'night' ? 'Night fee' : 'Peak fee'));
      }
    }

    // 5. Promo is a negative shown component funded by the platform.
    if (promoIqd > 0) {
      components.push({
        key: 'promo',
        label_ar: rules.get('promo')?.label_ar ?? 'خصم',
        label_en: rules.get('promo')?.label_en ?? 'Discount',
        amount: -promoIqd,
        driverShareRule: rules.get('promo')?.driverShareRule ?? 'platform_only',
        visibility: 'shown',
      });
    }

    const shown = components.filter((c) => c.visibility === 'shown');
    const shadow = components.filter((c) => c.visibility === 'shadow');

    const subtotal = sum(shown);
    const rounded = roundTo(subtotal, city.roundingStep);
    const { value: total, clamped } = clamp(rounded, vertical.floor, vertical.ceiling);
    const shadowTotal = clamp(roundTo(subtotal + sum(shadow), city.roundingStep), vertical.floor, vertical.ceiling).value;

    return {
      id: this.idFactory(),
      cityId: city.cityId,
      vertical: req.vertical,
      currency: 'IQD',
      components: shown,
      shadowComponents: shadow,
      subtotal,
      total,
      shadowTotal,
      rounding: { step: city.roundingStep, applied: rounded - subtotal },
      bounds: { floor: vertical.floor, ceiling: vertical.ceiling, clamped },
      createdAt: req.at,
    };
  }
}

export class PricingError extends Error {
  constructor(
    readonly code: 'city_mismatch' | 'vertical_not_configured',
    message: string,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

// ───────────────────────── helpers ─────────────────────────

interface Leg {
  from: string;
  to: string;
}

function legsOf(req: PriceRequest): Leg[] {
  const legs: Leg[] = [];
  for (let i = 1; i < req.stops.length; i++) {
    const from = req.stops[i - 1];
    const to = req.stops[i];
    if (from && to) legs.push({ from: from.zoneId, to: to.zoneId });
  }
  return legs;
}

/** zoneId → tier for the city, used to resolve tier-pair fares. */
export function tierIndex(city: Pick<CityPricingConfig, 'zones'>): ReadonlyMap<string, ZoneTier> {
  return new Map(city.zones.map((z) => [z.id, z.tier]));
}

/**
 * Fare for one leg (dispatch & pricing spec §1):
 * 1. exact zone pair (symmetric unless an explicit reverse row exists);
 * 2. tier pair, first matching row in table order — put specific rows (centre↔near) before
 *    wildcards (any↔far) so "anything ↔ far = 1,500" and "edge = 2,000" resolve as written;
 * 3. the vertical's default fare.
 */
export function zoneFare(
  vertical: VerticalPricing,
  from: string,
  to: string,
  tiers: ReadonlyMap<string, ZoneTier> = new Map(),
): number {
  const exact = vertical.zoneFares.find((z) => z.from === from && z.to === to);
  if (exact) return exact.fare;
  const reverse = vertical.zoneFares.find((z) => z.from === to && z.to === from);
  if (reverse) return reverse.fare;

  const tf = tierFare(vertical, tiers.get(from), tiers.get(to));
  if (tf !== undefined) return tf;
  return vertical.defaultFare;
}

export function tierFare(vertical: VerticalPricing, from: ZoneTier | undefined, to: ZoneTier | undefined): number | undefined {
  if (!vertical.tierFares || !from || !to) return undefined;
  const matches = (a: ZoneTier | 'any', b: ZoneTier) => a === 'any' || a === b;
  const row = vertical.tierFares.find(
    (r) => (matches(r.from, from) && matches(r.to, to)) || (matches(r.from, to) && matches(r.to, from)),
  );
  return row?.fare;
}

function indexRules(rules: ComponentRule[]): Map<ComponentKey, ComponentRule> {
  return new Map(rules.map((r) => [r.key, r]));
}

interface Fallback {
  label_ar: string;
  label_en: string;
  driverShareRule: QuoteComponent['driverShareRule'];
}

function component(
  rules: Map<ComponentKey, ComponentRule>,
  key: ComponentKey,
  amount: number,
  opts: { leg?: number; fallback: Fallback },
): QuoteComponent {
  const rule = rules.get(key);
  return {
    key,
    label_ar: rule?.label_ar ?? opts.fallback.label_ar,
    label_en: rule?.label_en ?? opts.fallback.label_en,
    amount,
    driverShareRule: rule?.driverShareRule ?? opts.fallback.driverShareRule,
    visibility: rule?.visibility ?? 'shown',
    ...(opts.leg !== undefined ? { leg: opts.leg } : {}),
  };
}

function flat(rules: Map<ComponentKey, ComponentRule>, key: ComponentKey, ar: string, en: string): QuoteComponent {
  const rule = rules.get(key);
  return component(rules, key, rule?.amount ?? 0, {
    fallback: { label_ar: ar, label_en: en, driverShareRule: 'driver_full' },
  });
}

/** Metered components default to shadow when the rule is absent — never silently charged. */
function metered(key: ComponentKey, units: number, rule: ComponentRule | undefined, ar: string, en: string): QuoteComponent {
  const amount = Math.round(units * (rule?.perUnit ?? 0));
  return {
    key,
    label_ar: rule?.label_ar ?? ar,
    label_en: rule?.label_en ?? en,
    amount,
    driverShareRule: rule?.driverShareRule ?? 'driver_commissioned',
    visibility: rule?.visibility ?? 'shadow',
  };
}

export function roundTo(amount: number, step: number): number {
  if (step <= 0) return amount;
  return Math.round(amount / step) * step;
}

export function clamp(value: number, floor?: number, ceiling?: number): { value: number; clamped: boolean } {
  let v = value;
  if (floor !== undefined && v < floor) v = floor;
  if (ceiling !== undefined && v > ceiling) v = ceiling;
  return { value: v, clamped: v !== value };
}

function sum(components: QuoteComponent[]): number {
  return components.reduce((acc, c) => acc + c.amount, 0);
}

/** Hour window [start, end); wraps midnight when start > end (e.g. [22, 6)). */
export function inWindow(hour: number, [start, end]: readonly [number, number]): boolean {
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function localHour(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  return hour ? Number(hour) : at.getUTCHours();
}

let counter = 0;
function defaultId(): string {
  counter += 1;
  return `q_${Date.now().toString(36)}_${counter.toString(36)}`;
}
