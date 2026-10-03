import type { ScoreMetric, ScoreMetricKey, ScoreNudge } from '@driver/contracts';

/**
 * The driver's card (scoring spec §1) as the Partner app shows it: five components over a rolling
 * 14-day window (the older week weighs half). Pure: the caller hands in the driver's own events,
 * his trips, the delivery ratings customers gave him and his cash-account lines.
 *
 * Mapping from the spec's table: acceptance folds in timeouts (offers seen and left count as not
 * accepted); completion is the inverse of "cancellations after accept"; cash return is "cash
 * discrepancies" read as punctuality (collected cash handed back within 24 h). Each component's
 * Silver line is where it falls to 70 % of its weight; a nudge goes out below it.
 */

export const RELIABILITY_WINDOW_DAYS = 14;
export const OBSERVATION_DAYS = 30;
export const GOLD_MIN_COMPLETED = 100;
const DAY_MS = 86_400_000;
const ON_TIME_GRACE_MS = 3 * 60_000;
const CASH_RETURN_MS = 24 * 60 * 60_000;
const SILVER_SHARE = 0.7;

interface MetricDef {
  key: ScoreMetricKey;
  label_ar: string;
  weight: number;
  fullAt: number;
  zeroAt: number;
}

export const METRIC_DEFS: readonly MetricDef[] = [
  { key: 'acceptance', label_ar: 'نسبة القبول', weight: 20, fullAt: 0.85, zeroAt: 0.5 },
  { key: 'completion', label_ar: 'إكمال الطلبات', weight: 15, fullAt: 1, zeroAt: 0.96 },
  { key: 'on_time', label_ar: 'الوصول بالوقت', weight: 20, fullAt: 0.9, zeroAt: 0.6 },
  { key: 'rating', label_ar: 'تقييم الزبائن', weight: 15, fullAt: 4.8, zeroAt: 4.0 },
  { key: 'cash_return', label_ar: 'ترجيع الكاش بوقته', weight: 5, fullAt: 0.95, zeroAt: 0.7 },
];

export interface ReliabilityInputs {
  /** The driver's own events (actor = driver): trip.accepted / trip.declined / trip.timed_out… */
  events: ReadonlyArray<{ type: string; occurredAt: Date }>;
  trips: ReadonlyArray<{
    state: string;
    acceptedAt: Date | null;
    stops: ReadonlyArray<{ windowEnd: Date | null; arrivedAt: Date | null }>;
  }>;
  /** Delivery ratings (1–5) customers gave him, any age; the last 50 count. */
  ratings: ReadonlyArray<{ score: number; at: Date }>;
  /** His `cash:` account lines (signed for the account: − collected, + handed back). */
  cash: ReadonlyArray<{ amountIqd: number; at: Date }>;
}

export interface ReliabilityCard {
  index: number;
  tier: 'bronze' | 'silver' | 'gold';
  completedTrips: number;
  metrics: ScoreMetric[];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function reliabilityCard(input: ReliabilityInputs, now: Date): ReliabilityCard {
  const start = now.getTime() - RELIABILITY_WINDOW_DAYS * DAY_MS;
  const half = now.getTime() - 7 * DAY_MS;
  /** 1 in the last week, ½ in the week before, 0 outside the window. */
  const w = (at: Date | null): number => {
    if (!at) return 0;
    const t = at.getTime();
    if (t > now.getTime() || t < start) return 0;
    return t >= half ? 1 : 0.5;
  };

  // acceptance (offers answered): accepted / (accepted + declined + timed out)
  let acc = 0;
  let offers = 0;
  let offerSamples = 0;
  for (const e of input.events) {
    const k = w(e.occurredAt);
    if (k === 0) continue;
    if (e.type === 'trip.accepted') {
      acc += k;
      offers += k;
      offerSamples += 1;
    } else if (e.type === 'trip.declined' || e.type === 'trip.timed_out') {
      offers += k;
      offerSamples += 1;
    }
  }

  // completion and on-time from his trips
  let done = 0;
  let finished = 0;
  let completionSamples = 0;
  let onTime = 0;
  let timed = 0;
  let timedSamples = 0;
  let completedTrips = 0;
  for (const t of input.trips) {
    if (t.state === 'completed') completedTrips += 1;
    const k = w(t.acceptedAt);
    if (k > 0 && (t.state === 'completed' || t.state === 'driver_cancelled')) {
      finished += k;
      completionSamples += 1;
      if (t.state === 'completed') done += k;
    }
    for (const s of t.stops) {
      if (!s.windowEnd || !s.arrivedAt) continue;
      const ks = w(s.arrivedAt);
      if (ks === 0) continue;
      timed += ks;
      timedSamples += 1;
      if (s.arrivedAt.getTime() <= s.windowEnd.getTime() + ON_TIME_GRACE_MS) onTime += ks;
    }
  }

  const ratings = [...input.ratings].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 50);
  const ratingAvg = ratings.length > 0 ? ratings.reduce((s, r) => s + r.score, 0) / ratings.length : null;

  const cash = cashPunctuality(input.cash, now, start);

  const values: Record<ScoreMetricKey, { value: number | null; samples: number }> = {
    acceptance: { value: offers > 0 ? acc / offers : null, samples: offerSamples },
    completion: { value: finished > 0 ? done / finished : null, samples: completionSamples },
    on_time: { value: timed > 0 ? onTime / timed : null, samples: timedSamples },
    rating: { value: ratingAvg, samples: ratings.length },
    cash_return: cash,
  };

  let earned = 0;
  let possible = 0;
  const metrics: ScoreMetric[] = METRIC_DEFS.map((d) => {
    const { value, samples } = values[d.key];
    const silverLine = d.zeroAt + SILVER_SHARE * (d.fullAt - d.zeroAt);
    const score = value === null ? 1 : clamp01((value - d.zeroAt) / (d.fullAt - d.zeroAt));
    if (value !== null) {
      earned += score * d.weight;
      possible += d.weight;
    }
    return {
      key: d.key,
      label_ar: d.label_ar,
      value: value === null ? null : Math.round(value * 1000) / 1000,
      display: value === null ? '—' : d.key === 'rating' ? value.toFixed(1) : pct(value),
      samples,
      fullAt: d.fullAt,
      zeroAt: d.zeroAt,
      silverLine: Math.round(silverLine * 1000) / 1000,
      score: Math.round(score * 1000) / 1000,
      weight: d.weight,
      belowSilver: value !== null && value < silverLine,
    };
  });
  const index = possible > 0 ? Math.round((100 * earned) / possible) : 100;
  const tier = index >= 85 && completedTrips >= GOLD_MIN_COMPLETED ? 'gold' : index >= 70 ? 'silver' : 'bronze';
  return { index, tier, completedTrips, metrics };
}

/**
 * Share (by amount) of the cash he collected in the window that went back (to a merchant or the
 * company) within 24 h, FIFO. Collections whose 24 h are not over yet and still open are not judged.
 */
export function cashPunctuality(lines: ReadonlyArray<{ amountIqd: number; at: Date }>, now: Date, windowStart: number): { value: number | null; samples: number } {
  const sorted = [...lines].sort((a, b) => a.at.getTime() - b.at.getTime());
  const open: Array<{ at: number; left: number; amount: number; returnedOnTime: number }> = [];
  const judged: typeof open = [];
  for (const l of sorted) {
    if (l.amountIqd < 0) {
      const c = { at: l.at.getTime(), left: -l.amountIqd, amount: -l.amountIqd, returnedOnTime: 0 };
      open.push(c);
      judged.push(c);
      continue;
    }
    let back = l.amountIqd;
    for (const c of open) {
      if (back <= 0) break;
      if (c.left <= 0) continue;
      const take = Math.min(c.left, back);
      c.left -= take;
      back -= take;
      if (l.at.getTime() - c.at <= CASH_RETURN_MS) c.returnedOnTime += take;
    }
  }
  let onTime = 0;
  let total = 0;
  let samples = 0;
  for (const c of judged) {
    if (c.at < windowStart || c.at > now.getTime()) continue;
    const due = c.at + CASH_RETURN_MS;
    if (c.left > 0 && due > now.getTime()) continue;
    total += c.amount;
    onTime += c.returnedOnTime;
    samples += 1;
  }
  return { value: total > 0 ? onTime / total : null, samples };
}

const NUDGES: Record<ScoreMetricKey, (m: ScoreMetric) => { ar: string; en: string }> = {
  acceptance: (m) => ({
    ar: `نسبة قبولك ${m.display}، تحت خط الفضي (${Math.round(m.silverLine * 100)}%). اقبل الطلبات القريبة منك حتى ترجع فوگ.`,
    en: `Your acceptance is ${m.display}, below the Silver line. Accept nearby offers to get back above it.`,
  }),
  completion: () => ({
    ar: 'عندك إلغاءات بعد القبول. كمّل الطلب أو كلّم الموزّع بدل ما تلغي.',
    en: 'You cancelled jobs after accepting. Finish the job or call dispatch instead of cancelling.',
  }),
  on_time: (m) => ({
    ar: `وصولك بالوقت ${m.display}. حاول توصل خلال ٣ دقايق من الوقت المتوقع.`,
    en: `On-time arrival is ${m.display}. Try to arrive within 3 minutes of the ETA.`,
  }),
  rating: (m) => ({
    ar: `تقييم الزبائن ${m.display}. الكلام الزين والتسليم المرتب يرفعون التقييم.`,
    en: `Customer rating is ${m.display}. Courtesy and a tidy hand-over lift it.`,
  }),
  cash_return: () => ({
    ar: 'رجّع الكاش للمطاعم وللشركة بنفس اليوم حتى ما ينزل سقف الكاش مالتك.',
    en: 'Return collected cash the same day so your cash cap is not lowered.',
  }),
};

/** Same-evening nudges (Iraqi Arabic) for the components under their Silver line. */
export function nudgesFor(metrics: readonly ScoreMetric[]): ScoreNudge[] {
  return metrics.filter((m) => m.belowSilver).map((m) => {
    const n = NUDGES[m.key](m);
    return { key: m.key, message_ar: n.ar, message_en: n.en };
  });
}
