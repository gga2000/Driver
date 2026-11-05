import { cityParts, t } from '@driver/i18n';

/**
 * The new customer home's rules (docs/specs/2026-11-01-home-redesign.md §12): which panel sits under the
 * map card, the order steps, the river's fill, the live tag's age and the seat squares. Pure, so the
 * app and the gallery agree and tests pin them.
 */

export type Meal = 'lunch' | 'dinner';
export type PanelMode = 'order' | 'offers' | 'calm';
/** `cancelled` ends the card early: no steps, no minutes, just the panel's notice. */
export type OrderStage = 'placed' | 'preparing' | 'on_way' | 'arrived' | 'cancelled';
export type TrackerStep = 'done' | 'now' | 'next';

/** The four steps in order; their names are `home.step.<stage>`. */
export const STAGES = ['placed', 'preparing', 'on_way', 'arrived'] as const satisfies readonly OrderStage[];

/** A step's name: «طلبت», «دا يتحضّر», «بالطريق», «وصل»; a ride's: «طلبت», «السايق جاي», «بالطريق», «وصلت». */
export const stepName = (s: (typeof STAGES)[number], ride = false) => t(ride ? `home.step.ride_${s}` : `home.step.${s}`);

/** The order still runs (it has steps and minutes). */
export function stageRuns(stage: OrderStage): boolean {
  return stage !== 'arrived' && stage !== 'cancelled';
}

/** Lunch 12:00–14:59, dinner 19:00–22:59 on the city clock (Ali, 2026-11-02); otherwise no meal. */
export function mealWindow(now: Date | number): Meal | null {
  const h = cityParts(now).hour;
  if (h >= 12 && h < 15) return 'lunch';
  if (h >= 19 && h < 23) return 'dinner';
  return null;
}

/** "2026-11-05:lunch": the meal the customer saw offers for, stored so scrolling past them calms the panel for that meal only. */
export function mealKey(now: Date | number): string | null {
  const meal = mealWindow(now);
  if (!meal) return null;
  const p = cityParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}:${meal}`;
}

export interface PanelModeInput {
  /** An order or a ride is running. */
  running: boolean;
  now: Date | number;
  /** Merchant-funded offers open now (no money rule here: they already exist). */
  offers: number;
  /** The `mealKey` whose offers the customer already saw and scrolled past, if any. */
  seenMeal: string | null;
}

/** Order while anything runs; offers at a meal time when some exist and weren't seen yet; calm otherwise. */
export function panelMode({ running, now, offers, seenMeal }: PanelModeInput): PanelMode {
  if (running) return 'order';
  const key = mealKey(now);
  if (key && offers > 0 && seenMeal !== key) return 'offers';
  return 'calm';
}

/** The four steps طلبت · دا يتحضّر · بالطريق · وصل; at «وصل» every step is done. */
export function trackerSteps(stage: OrderStage): TrackerStep[] {
  if (stage === 'arrived') return STAGES.map(() => 'done');
  if (stage === 'cancelled') return [];
  // An unknown stage from an older server reads as the first step, never as "nothing done".
  const at = Math.max(0, (STAGES as readonly OrderStage[]).indexOf(stage));
  return STAGES.map((_, i) => (i < at ? 'done' : i === at ? 'now' : 'next'));
}

/** How much of the river is orange: a quarter per step, full on arrival, none with no order. */
export function riverFill(stage: OrderStage | null): number {
  if (!stage || stage === 'cancelled') return 0;
  return (Math.max(0, (STAGES as readonly OrderStage[]).indexOf(stage)) + 1) / STAGES.length;
}

export interface LiveAge {
  unit: 'now' | 'sec' | 'min';
  n: number;
  /** Over 2 minutes old: the tag stops saying «مباشر». */
  stale?: boolean;
}

/** Past this many seconds the live tag stops saying «مباشر» and says when the last update came. */
export const STALE_AFTER_SEC = 120;

/** The live tag's age: «هسة» under 5 s, seconds under a minute, then whole minutes. */
export function liveAge(seconds: number): LiveAge {
  const s = Math.max(0, Math.floor(seconds));
  const stale = s > STALE_AFTER_SEC ? { stale: true } : {};
  if (s < 5) return { unit: 'now', n: 0, ...stale };
  if (s < 60) return { unit: 'sec', n: s, ...stale };
  return { unit: 'min', n: Math.floor(s / 60), ...stale };
}

/**
 * What the live tag says: offline first («ماكو انترنت · آخر تحديث قبل 4 دقايق»), then the town with no
 * order, then stale («آخر تحديث قبل 3 دقايق»), then how fresh («مباشر · قبل 8 ثواني»).
 */
export function liveLabel(ageSec: number | undefined, offline: boolean, town: string): string {
  const age = ageSec === undefined ? null : liveAge(ageSec);
  if (offline) return age?.unit === 'min' ? t('home.live_offline', { n: age.n }) : t('home.live_offline_now');
  if (age === null) return t('home.live_town', { town });
  if (age.stale) return t('home.live_stale', { n: age.n });
  if (age.unit === 'now') return t('home.live_now');
  return t(age.unit === 'sec' ? 'home.live_sec' : 'home.live_min', { n: age.n });
}

/** «خطوة 2 من 4: دا يتحضّر» for the step row; at the end, the last step. */
export function stepsA11y(steps: readonly TrackerStep[], ride = false): string {
  if (steps.length === 0) return '';
  const now = steps.indexOf('now');
  const at = now === -1 ? steps.length - 1 : now;
  return t('home.step_of', { n: at + 1, total: steps.length, step: stepName(STAGES[at]!, ride) });
}

/** Minutes as the panel shows them: whole, never below 0 (0 reads «يوصل هسة»). */
export const panelMinutes = (m: number) => Math.max(0, Math.round(m));
