import { describe, expect, it } from 'vitest';
import { alarmAction, alarmPlan, alarmQuiet, LADDER, snooze, SNOOZE_FLOOR_MS, SNOOZE_MS, stageFor, STAGE_REPEAT_MS, STAGE_VOLUME, type AlarmStage, type RingCandidate } from './ladder';

const T0 = 1_790_000_000_000;
const order = (id: string, acceptInMs: number | null, now = T0): RingCandidate => ({ id, number: id.replace('o', '1'), acceptByMs: acceptInMs === null ? null : now + acceptInMs });

/** Runs the 250-ms tick from `from` to `to` and records what the engine was asked to do. */
function simulate(candidates: RingCandidate[], from: number, to: number, opts: { snoozeAt?: number; canRing?: boolean } = {}) {
  let last = 0;
  let snoozed = new Map<string, number>();
  const chimes: Array<{ at: number; stage: AlarmStage }> = [];
  let loopStartedAt: number | null = null;
  for (let now = from; now <= to; now += 250) {
    if (opts.snoozeAt !== undefined && now === opts.snoozeAt) {
      const ringing = alarmPlan(candidates, snoozed, new Set(), now).ringing;
      snoozed = snooze(snoozed, ringing, now, candidates.map((c) => c.id));
    }
    const plan = alarmPlan(candidates, snoozed, new Set(), now);
    const a = alarmAction(plan.stage, last, now, opts.canRing ?? true);
    if (a.kind === 'chime') {
      chimes.push({ at: now - from, stage: a.stage });
      last = now;
    }
    if (a.kind === 'loop' && loopStartedAt === null) loopStartedAt = now - from;
  }
  return { chimes, loopStartedAt };
}

describe('alarm ladder (M-02)', () => {
  it('stages by time left in three 30-s steps (a2): calm > 60 s, urgent 60–31 s, final ≤ 30 s', () => {
    expect(stageFor(90_000)).toBe('calm');
    expect(stageFor(60_001)).toBe('calm');
    expect(stageFor(60_000)).toBe('urgent');
    expect(stageFor(30_001)).toBe('urgent');
    expect(stageFor(30_000)).toBe('final');
    expect(stageFor(0)).toBe('final');
    expect(stageFor(null)).toBe('calm');
    expect(LADDER).toEqual({ urgentAtMs: 60_000, finalAtMs: 30_000 });
  });

  it('gets louder and faster as the 90 s run out', () => {
    expect(STAGE_REPEAT_MS.calm).toBe(4_000);
    expect(STAGE_REPEAT_MS.urgent).toBe(2_000);
    expect(STAGE_VOLUME.calm).toBeLessThan(STAGE_VOLUME.urgent);
    expect(STAGE_VOLUME.urgent).toBeLessThan(STAGE_VOLUME.final);
    expect(STAGE_VOLUME.final).toBe(1);
  });

  it('a 90-s order: a chime every 4 s for 30 s, every 2 s for 30 s, then the steady bell for the last 30 s', () => {
    const { chimes, loopStartedAt } = simulate([order('o1', 90_000)], T0, T0 + 90_000);
    const calm = chimes.filter((c) => c.stage === 'calm');
    const urgent = chimes.filter((c) => c.stage === 'urgent');
    expect(calm.map((c) => c.at)).toEqual([0, 4_000, 8_000, 12_000, 16_000, 20_000, 24_000, 28_000]);
    // The first urgent chime comes the moment 60 s are left (30 s in), then every 2 s until 30 s left.
    expect(urgent.map((c) => c.at)).toEqual([30_000, 32_000, 34_000, 36_000, 38_000, 40_000, 42_000, 44_000, 46_000, 48_000, 50_000, 52_000, 54_000, 56_000, 58_000]);
    expect(loopStartedAt).toBe(60_000);
  });

  it('stays silent when sound cannot play (browser locked or switched off)', () => {
    const { chimes, loopStartedAt } = simulate([order('o1', 90_000)], T0, T0 + 90_000, { canRing: false });
    expect(chimes).toEqual([]);
    expect(loopStartedAt).toBeNull();
    expect(alarmAction(null, 0, T0, true)).toEqual({ kind: 'silent' });
  });

  it('the most urgent order sets the stage for the whole board', () => {
    const plan = alarmPlan([order('o1', 80_000), order('o2', 45_000), order('o3', 70_000)], new Map(), new Set(), T0);
    expect(plan.ringing).toEqual(['o1', 'o2', 'o3']);
    expect(plan.stage).toBe('urgent');
    expect(plan.mostUrgent).toEqual({ id: 'o2', number: '12', msLeft: 45_000 });
  });

  it('an open accept/reject sheet keeps that order quiet', () => {
    const plan = alarmPlan([order('o1', 80_000), order('o2', 25_000)], new Map(), new Set(['o2']), T0);
    expect(plan.ringing).toEqual(['o1']);
    expect(plan.stage).toBe('calm');
  });
});

describe('"سكّت 30 ثانية" is a snooze, never a silence', () => {
  it('quiet for 30 s, then rings again', () => {
    // Snoozed 4 s in (86 s left), just before the second chime: quiet until 34 s in, then it rings again
    // at the step it has reached by then (urgent, every 2 s).
    const { chimes } = simulate([order('o1', 90_000)], T0, T0 + 50_000, { snoozeAt: T0 + 4_000 });
    expect(SNOOZE_MS).toBe(30_000);
    expect(chimes.map((c) => c.at)).toEqual([0, 34_000, 36_000, 38_000, 40_000, 42_000, 44_000, 46_000, 48_000, 50_000]);
  });

  it('rings again when the last 30 s start, whatever happens: the steady bell is never snoozed', () => {
    expect(SNOOZE_FLOOR_MS).toBe(30_000);
    // Snoozed with 50 s left: the floor (30 s left) comes before the 30 s are up.
    const c = [order('o1', 50_000)];
    const s = snooze(new Map(), ['o1'], T0, ['o1']);
    expect(alarmPlan(c, s, new Set(), T0 + 19_000).ringing).toEqual([]);
    const at20 = alarmPlan(c, s, new Set(), T0 + 20_000);
    expect(at20.ringing).toEqual(['o1']);
    expect(at20.stage).toBe('final');
    // While snoozed, it says when it rings again: the floor, 20 s from now.
    expect(alarmPlan(c, s, new Set(), T0).snoozeEndsAt).toBe(T0 + 20_000);
  });

  it('a newer order rings straight away during a snooze', () => {
    const s = snooze(new Map(), ['o1'], T0, ['o1']);
    const plan = alarmPlan([order('o1', 80_000), order('o2', 90_000)], s, new Set(), T0 + 1_000);
    expect(plan.ringing).toEqual(['o2']);
    expect(plan.snoozed).toEqual(['o1']);
  });

  it('drops snoozes of orders that left the board', () => {
    const s = snooze(new Map([['gone', T0 + 10_000]]), ['o1'], T0, ['o1']);
    expect([...s.keys()]).toEqual(['o1']);
  });
});

describe('a closed store never rings (m6a)', () => {
  it('waiting orders are listed as closed, quietly, with the most urgent still named; nothing rings, not even the final 10 s', () => {
    const c = [order('o1', 80_000), order('o2', 8_000), order('o3', 60_000)];
    const plan = alarmPlan(c, new Map(), new Set(['o3']), T0, true);
    expect(plan).toEqual({ ringing: [], snoozed: [], closed: ['o1', 'o2'], stage: null, mostUrgent: { id: 'o2', number: '12', msLeft: 8_000 }, snoozeEndsAt: null });
    expect(alarmAction(plan.stage, 0, T0, true)).toEqual({ kind: 'silent' });
    // The whole 90-s window of an order left waiting at close: not one chime, no final loop.
    const quiet = { chimes: 0, loops: 0 };
    for (let now = T0; now <= T0 + 90_000; now += 250) {
      const a = alarmAction(alarmPlan([order('o4', 90_000)], new Map(), new Set(), now, true).stage, 0, now, true);
      if (a.kind === 'chime') quiet.chimes += 1;
      if (a.kind === 'loop') quiet.loops += 1;
    }
    expect(quiet).toEqual({ chimes: 0, loops: 0 });
  });

  it('a snooze does not matter while closed, and opening again rings straight away', () => {
    const c = [order('o1', 80_000)];
    const s = snooze(new Map(), ['o1'], T0 - 10_000, ['o1']);
    expect(alarmPlan(c, s, new Set(), T0, true)).toMatchObject({ ringing: [], snoozed: [], closed: ['o1'] });
    expect(alarmPlan(c, new Map(), new Set(), T0, false)).toMatchObject({ ringing: ['o1'], closed: [], stage: 'calm' });
  });

  it('closed = closed by hand (the end-of-day card) or out of hours; a prayer pause or the 00:30 card of a store still open keeps ringing', () => {
    const at = new Date('2026-10-06T19:00:00Z');
    expect(alarmQuiet(undefined)).toBe(false);
    expect(alarmQuiet({ closed: null, schedule: { inHours: true } })).toBe(false);
    expect(alarmQuiet({ closed: null })).toBe(false);
    expect(alarmQuiet({ closed: { reason: 'closing_early', note: null, at }, schedule: { inHours: true } })).toBe(true);
    expect(alarmQuiet({ closed: null, schedule: { inHours: false } })).toBe(true);
    // Friday prayer: the status carries `pause`, not `closed`.
    expect(alarmQuiet({ closed: null, schedule: null })).toBe(false);
  });
});
