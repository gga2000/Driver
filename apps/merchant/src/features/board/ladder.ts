/**
 * The new-order alarm ladder (UI/UX audit M-02, signature S-M1), free of React and audio so the
 * timing is unit-tested. A kitchen needs escalation, not a metronome:
 *
 *   more than 30 s left   calm     chime every 4 s
 *   30 – 11 s left        urgent   chime every 2 s, ring and card border turn danger, louder
 *   10 s or less          final    continuous tone + "باقي 10 ثواني على #3912" banner, full volume
 *
 * "سكّت 30 ثانية" snoozes the orders ringing at that moment for 30 s — never for good: a snoozed order
 * rings again at 20 s left whatever happens, and a newer order rings straight away.
 */

export type AlarmStage = 'calm' | 'urgent' | 'final';

/** Time left (ms) at which each stage starts. */
export const LADDER = { urgentAtMs: 30_000, finalAtMs: 10_000 } as const;
/** Chime spacing per stage; `final` is a continuous loop (the engine's urgent tone), checked each second. */
export const STAGE_REPEAT_MS: Record<AlarmStage, number> = { calm: 4_000, urgent: 2_000, final: 1_000 };
/** Playback volume per stage (0–1). */
export const STAGE_VOLUME: Record<AlarmStage, number> = { calm: 0.75, urgent: 0.9, final: 1 };
/** "سكّت 30 ثانية". */
export const SNOOZE_MS = 30_000;
/** A snoozed order rings again once this little time is left, snooze or not. */
export const SNOOZE_FLOOR_MS = 20_000;

const RANK: Record<AlarmStage, number> = { calm: 0, urgent: 1, final: 2 };

export function stageFor(msLeft: number | null): AlarmStage {
  if (msLeft === null) return 'calm';
  if (msLeft <= LADDER.finalAtMs) return 'final';
  if (msLeft <= LADDER.urgentAtMs) return 'urgent';
  return 'calm';
}

/** A new order waiting for the kitchen: its id and the end of its 90-s window (server time, ms). */
export interface RingCandidate {
  id: string;
  number: string;
  acceptByMs: number | null;
}

export interface AlarmPlan {
  /** Orders making noise right now. */
  ringing: string[];
  /** Orders quiet because of "سكّت 30 ثانية". */
  snoozed: string[];
  /** The loudest stage among the ringing orders; null when nothing rings. */
  stage: AlarmStage | null;
  /** The waiting order with the least time left (ringing or snoozed): the final banner names it. */
  mostUrgent: { id: string; number: string; msLeft: number | null } | null;
  /** When the earliest snooze ends (for "يرجع يرن بعد 24 ث"); null without one. */
  snoozeEndsAt: number | null;
}

/**
 * What should ring now. `snoozedUntil` maps an order to the end of its snooze; `handling` holds
 * orders whose accept/reject sheet is open (the cook is on it: quiet until the sheet closes).
 */
export function alarmPlan(candidates: readonly RingCandidate[], snoozedUntil: ReadonlyMap<string, number>, handling: ReadonlySet<string>, now: number): AlarmPlan {
  const ringing: string[] = [];
  const snoozed: string[] = [];
  let stage: AlarmStage | null = null;
  let mostUrgent: AlarmPlan['mostUrgent'] = null;
  let snoozeEndsAt: number | null = null;
  for (const c of candidates) {
    if (handling.has(c.id)) continue;
    const msLeft = c.acceptByMs === null ? null : c.acceptByMs - now;
    if (mostUrgent === null || (msLeft !== null && (mostUrgent.msLeft === null || msLeft < mostUrgent.msLeft))) mostUrgent = { id: c.id, number: c.number, msLeft };
    const until = snoozedUntil.get(c.id);
    const floorReached = msLeft !== null && msLeft <= SNOOZE_FLOOR_MS;
    if (until !== undefined && until > now && !floorReached) {
      snoozed.push(c.id);
      // The snooze ends at its 30 s or at the 20-s floor, whichever comes first.
      const ends = msLeft === null ? until : Math.min(until, now + msLeft - SNOOZE_FLOOR_MS);
      snoozeEndsAt = snoozeEndsAt === null ? ends : Math.min(snoozeEndsAt, ends);
      continue;
    }
    ringing.push(c.id);
    const s = stageFor(msLeft);
    if (stage === null || RANK[s] > RANK[stage]) stage = s;
  }
  return { ringing, snoozed, stage, mostUrgent, snoozeEndsAt };
}

/** Snoozes the given orders from `now`; expired entries for orders no longer waiting are dropped. */
export function snooze(snoozedUntil: ReadonlyMap<string, number>, ids: readonly string[], now: number, waiting: readonly string[]): Map<string, number> {
  const next = new Map<string, number>();
  for (const [id, until] of snoozedUntil) if (until > now && waiting.includes(id)) next.set(id, until);
  for (const id of ids) next.set(id, now + SNOOZE_MS);
  return next;
}

/** What the sound engine should do on this tick. */
export type AlarmAction = { kind: 'silent' } | { kind: 'chime'; stage: 'calm' | 'urgent' } | { kind: 'loop' } | { kind: 'wait' };

/**
 * One tick of the alarm (every 250 ms): silence, a chime at the stage's spacing, or the final loop.
 * `lastChimeAt` is when the previous chime played (0 = never).
 */
export function alarmAction(stage: AlarmStage | null, lastChimeAt: number, now: number, canRing: boolean): AlarmAction {
  if (!canRing || stage === null) return { kind: 'silent' };
  if (stage === 'final') return { kind: 'loop' };
  return now - lastChimeAt >= STAGE_REPEAT_MS[stage] ? { kind: 'chime', stage } : { kind: 'wait' };
}

/** Vibration patterns (ms, Android `Vibration.vibrate`): one meaning each (haptics map, heavy = new order). */
export const VIBRATION: Record<AlarmStage, number[]> = {
  calm: [0, 400, 150, 400],
  urgent: [0, 250, 100, 250, 100, 250],
  final: [0, 600, 200],
};
