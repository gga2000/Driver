/**
 * Deals logic (pure, unit-tested): what state a deal shows, the propose wizard's draft → API input
 * (Baghdad dates), step checks and the schedule summary. No React Native here.
 */

export type ApiDealType = 'percent' | 'fixed' | 'free_delivery' | 'bogo';
export type ApiDealState = 'pending_approval' | 'approved' | 'rejected' | 'paused' | 'ended';

export interface DealLike {
  type: ApiDealType;
  value: number;
  itemIds: readonly string[];
  state: ApiDealState;
  active: boolean;
  schedule: { startsAt: Date; endsAt: Date; days: readonly number[]; hours?: { start: string; end: string } | undefined };
  budgetCapIqd: number | null;
  spentIqd: number;
}

/** What the merchant sees on a deal card (the server's state plus "scheduled" and "budget reached"). */
export type DealDisplay = 'pending' | 'active' | 'scheduled' | 'capped' | 'paused' | 'ended' | 'rejected';

export function dealDisplay(d: DealLike, now: number): DealDisplay {
  switch (d.state) {
    case 'pending_approval':
      return 'pending';
    case 'rejected':
      return 'rejected';
    case 'ended':
      return 'ended';
    case 'paused':
      return 'paused';
    case 'approved':
      if (d.schedule.startsAt.getTime() > now) return 'scheduled';
      if (d.budgetCapIqd !== null && d.spentIqd >= d.budgetCapIqd) return 'capped';
      return 'active';
  }
}

/** List order: what's running first, what needs a decision next, history last. */
const RANK: Record<DealDisplay, number> = { active: 0, pending: 1, scheduled: 2, paused: 3, capped: 4, rejected: 5, ended: 6 };

export function sortDeals<D extends DealLike & { createdAt: Date }>(deals: readonly D[], now: number): D[] {
  return [...deals].sort((a, b) => RANK[dealDisplay(a, now)] - RANK[dealDisplay(b, now)] || b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Owner's switch: pause a running/scheduled deal, resume a paused one. A deal waiting for Driver has
 * none (its state would not show the pause until approval).
 */
export function canToggle(display: DealDisplay): 'pause' | 'resume' | null {
  if (display === 'active' || display === 'scheduled' || display === 'capped') return 'pause';
  if (display === 'paused') return 'resume';
  return null;
}

// ───────────────────────── wizard ─────────────────────────

/** The four kinds the owner picks from; "item discount" is a fixed amount off chosen items. */
export type DealKind = 'percent' | 'free_delivery' | 'bogo' | 'item_discount';
export type HoursPreset = 'all' | 'lunch' | 'dinner' | 'late';

export const HOURS: Record<Exclude<HoursPreset, 'all'>, { start: string; end: string }> = {
  lunch: { start: '12:00', end: '16:00' },
  dinner: { start: '19:00', end: '23:00' },
  late: { start: '22:00', end: '01:00' },
};

export const PERCENT_CHOICES = [10, 15, 20, 25, 30] as const;
export const AMOUNT_CHOICES = [500, 1000, 1500, 2000] as const;
export const DURATION_CHOICES = [3, 7, 14, 30] as const;
export const START_CHOICES = [0, 1, 2, 7] as const;
export const MIN_ORDER_CHOICES = [0, 10_000, 15_000, 25_000] as const;
export const MAX_PERCENT = 50;

export interface DealDraft {
  kind: DealKind | null;
  percent: number;
  amountIqd: number;
  /** Covered items; empty = whole menu (percent / free delivery only). */
  itemIds: string[];
  nameAr: string;
  /** Days from today: 0 = starts now. */
  startInDays: number;
  durationDays: number;
  /** Local days 0 = Sunday … 6; empty = every day. */
  days: number[];
  hours: HoursPreset;
  minOrderIqd: number;
  budgetCapIqd: number | null;
}

export function emptyDraft(): DealDraft {
  return { kind: null, percent: 15, amountIqd: 1000, itemIds: [], nameAr: '', startInDays: 0, durationDays: 7, days: [], hours: 'all', minOrderIqd: 0, budgetCapIqd: null };
}

export function apiType(kind: DealKind): ApiDealType {
  return kind === 'item_discount' ? 'fixed' : kind;
}

/** The kind back from a stored deal (fixed amounts are always item discounts in this app). */
export function kindOf(type: ApiDealType): DealKind {
  return type === 'fixed' ? 'item_discount' : type;
}

export function needsItems(kind: DealKind | null): boolean {
  return kind === 'bogo' || kind === 'item_discount';
}

export type WizardStep = 'kind' | 'offer' | 'when' | 'review';
export const STEPS: readonly WizardStep[] = ['kind', 'offer', 'when', 'review'];

export type DraftProblem = 'kind' | 'percent' | 'amount' | 'items' | 'name' | 'days' | 'budget';

export function draftProblems(d: DealDraft, upTo: WizardStep = 'review'): DraftProblem[] {
  const out: DraftProblem[] = [];
  const reach = STEPS.indexOf(upTo);
  if (!d.kind) return ['kind'];
  if (reach >= 1) {
    if (d.kind === 'percent' && (d.percent < 1 || d.percent > MAX_PERCENT)) out.push('percent');
    if (d.kind === 'item_discount' && (d.amountIqd <= 0 || d.amountIqd % 250 !== 0)) out.push('amount');
    if (needsItems(d.kind) && d.itemIds.length === 0) out.push('items');
    const name = d.nameAr.trim();
    if (name.length > 0 && (name.length < 2 || name.length > 60)) out.push('name');
  }
  if (reach >= 2) {
    if (d.days.length === 7) out.push('days');
    if (d.budgetCapIqd !== null && d.budgetCapIqd <= 0) out.push('budget');
  }
  return out;
}

const BAGHDAD_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** 00:00 Baghdad of the local day `now` falls in. */
export function baghdadDayStart(now: number): number {
  return Math.floor((now + BAGHDAD_OFFSET_MS) / DAY_MS) * DAY_MS - BAGHDAD_OFFSET_MS;
}

/** Starts now (today) or at 00:00 Baghdad on the chosen day; ends at 00:00 after the last day. */
export function draftWindow(d: Pick<DealDraft, 'startInDays' | 'durationDays'>, now: number): { startsAt: Date; endsAt: Date } {
  const day0 = baghdadDayStart(now);
  const startsAt = d.startInDays <= 0 ? now : day0 + d.startInDays * DAY_MS;
  const endsAt = day0 + (Math.max(0, d.startInDays) + d.durationDays) * DAY_MS;
  return { startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
}

export interface ProposeInput {
  merchantOrgId: string;
  type: ApiDealType;
  value: number;
  nameAr: string;
  itemIds: string[];
  schedule: { startsAt: Date; endsAt: Date; days: number[]; hours?: { start: string; end: string } };
  budgetCapIqd?: number;
  minOrderIqd: number;
}

/** The draft as `deals.project` / `deals.propose` input; `fallbackName` when the owner left it empty. */
export function draftToInput(d: DealDraft, merchantOrgId: string, now: number, fallbackName: string): ProposeInput | null {
  if (!d.kind || draftProblems(d).length > 0) return null;
  const type = apiType(d.kind);
  const value = type === 'percent' ? d.percent : type === 'fixed' ? d.amountIqd : 0;
  const { startsAt, endsAt } = draftWindow(d, now);
  const name = d.nameAr.trim() || fallbackName;
  return {
    merchantOrgId,
    type,
    value,
    nameAr: name.slice(0, 60),
    itemIds: d.kind === 'free_delivery' ? [] : [...d.itemIds],
    schedule: { startsAt, endsAt, days: [...d.days].sort((a, b) => a - b), ...(d.hours !== 'all' ? { hours: HOURS[d.hours] } : {}) },
    ...(d.budgetCapIqd ? { budgetCapIqd: d.budgetCapIqd } : {}),
    minOrderIqd: d.minOrderIqd,
  };
}

/**
 * A stable key for the projection query: the start moves with the clock while the owner reads the
 * review, so it is rounded to the minute (otherwise every render would ask the server again).
 */
export function projectionKey(input: ProposeInput): ProposeInput {
  const minute = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);
  return { ...input, schedule: { ...input.schedule, startsAt: minute(input.schedule.startsAt), endsAt: minute(input.schedule.endsAt) } };
}

export function toggleDay(days: readonly number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
}

// ───────────────────────── display helpers ─────────────────────────

/** "5/10" (day/month, Baghdad, Western digits). */
export function dayMonth(at: Date | number): string {
  const d = new Date((typeof at === 'number' ? at : at.getTime()) + BAGHDAD_OFFSET_MS);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/** Baghdad weekday 0 = Sunday … 6 = Saturday. */
export function weekday(at: Date | number): number {
  return new Date((typeof at === 'number' ? at : at.getTime()) + BAGHDAD_OFFSET_MS).getUTCDay();
}

/** Last day the deal runs (the end is exclusive midnight). */
export function lastDay(endsAt: Date): Date {
  return new Date(endsAt.getTime() - 1);
}

/** Whole days between two instants (rounded), for "يومين" / "أسبوع". */
export function spanDays(startsAt: Date, endsAt: Date): number {
  return Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / DAY_MS));
}

/** Share of the budget used (0–1), null without a cap. */
export function budgetUse(d: Pick<DealLike, 'budgetCapIqd' | 'spentIqd'>): number | null {
  if (!d.budgetCapIqd) return null;
  return Math.max(0, Math.min(1, d.spentIqd / d.budgetCapIqd));
}
