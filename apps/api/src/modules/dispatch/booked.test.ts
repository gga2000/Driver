import { describe, expect, it } from 'vitest';
import { bookedStep, favouriteOnly, newBookedJob, openTo, riderState, type BookedJob } from './booked.js';

const H = 3_600_000;
const T = 24 * H; // the ride, 24:00 on the fake axis
const OFFER = 18 * H - 24 * H + T; // 18:00 the evening before
const DEADLINE = OFFER + 4 * H; // 22:00

const job = (fav: string | null = null): BookedJob =>
  newBookedJob({ orderId: 'o1', scheduledFor: T + 5 * H, offerAt: OFFER, confirmBy: DEADLINE, favouriteId: fav, favouriteUntil: OFFER + H });

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return null;
};

describe('booked ride state machine (review #28)', () => {
  it('offered → confirmed → reminded → started', () => {
    let j = bookedStep(job(), { kind: 'open' }, OFFER);
    expect(j).toMatchObject({ state: 'offered', openedAt: OFFER });
    j = bookedStep(j, { kind: 'confirm', driverId: 'd1' }, OFFER + 10_000);
    expect(j).toMatchObject({ state: 'confirmed', driverId: 'd1', confirmedAt: OFFER + 10_000 });
    j = bookedStep(j, { kind: 'deadline' }, DEADLINE);
    expect(j.state).toBe('confirmed');
    j = bookedStep(j, { kind: 'remind' }, T + 4 * H);
    expect(j.state).toBe('reminded');
    j = bookedStep(j, { kind: 'start', driverId: 'd1' }, T + 4.5 * H);
    expect(j).toMatchObject({ state: 'started', driverId: 'd1' });
    expect(riderState(j)).toBe('confirmed');
  });

  it('nobody by the deadline → unconfirmed (the fallback search at T−30)', () => {
    let j = bookedStep(job(), { kind: 'open' }, OFFER);
    expect(riderState(j)).toBe('looking');
    j = bookedStep(j, { kind: 'deadline' }, DEADLINE);
    expect(j.state).toBe('unconfirmed');
    expect(riderState(j)).toBe('later');
    expect(code(() => bookedStep(j, { kind: 'confirm', driverId: 'd1' }, DEADLINE + 1))).toBe('booked_job_closed');
  });

  it('released before the deadline → back on offer, never to him again', () => {
    let j = bookedStep(bookedStep(job(), { kind: 'open' }, OFFER), { kind: 'confirm', driverId: 'd1' }, OFFER);
    j = bookedStep(j, { kind: 'release', driverId: 'd1' }, OFFER + H);
    expect(j).toMatchObject({ state: 'offered', driverId: null, releasedBy: ['d1'] });
    expect(openTo(j, 'd1', OFFER + H)).toBe(false);
    expect(openTo(j, 'd2', OFFER + H)).toBe(true);
    expect(code(() => bookedStep(j, { kind: 'confirm', driverId: 'd1' }, OFFER + H))).toBe('booked_job_closed');
    j = bookedStep(j, { kind: 'confirm', driverId: 'd2' }, OFFER + 2 * H);
    expect(j.driverId).toBe('d2');
  });

  it('released after the deadline, or no-show at T−30 → released (fallback)', () => {
    const held = bookedStep(bookedStep(job(), { kind: 'open' }, OFFER), { kind: 'confirm', driverId: 'd1' }, OFFER);
    expect(bookedStep(held, { kind: 'release', driverId: 'd1' }, DEADLINE + H)).toMatchObject({ state: 'released', releasedBy: ['d1'] });
    const late = bookedStep(held, { kind: 'no_show' }, T + 4.5 * H);
    expect(late).toMatchObject({ state: 'released', driverId: null, releasedBy: ['d1'] });
    expect(riderState(late)).toBe('later');
  });

  it('first confirm wins: a second driver is refused, the same driver is a no-op', () => {
    const j = bookedStep(bookedStep(job(), { kind: 'open' }, OFFER), { kind: 'confirm', driverId: 'd1' }, OFFER);
    expect(code(() => bookedStep(j, { kind: 'confirm', driverId: 'd2' }, OFFER + 1))).toBe('booked_job_taken');
    expect(bookedStep(j, { kind: 'confirm', driverId: 'd1' }, OFFER + 1)).toBe(j);
  });

  it('the favourite has it alone for his hour; his «مو إلي» opens it to everyone', () => {
    let j = bookedStep(job('fav'), { kind: 'open' }, OFFER);
    expect(j.openedAt).toBeNull();
    expect(favouriteOnly(j, OFFER + 1)).toBe(true);
    expect(openTo(j, 'd2', OFFER + 1)).toBe(false);
    expect(openTo(j, 'fav', OFFER + 1)).toBe(true);
    expect(code(() => bookedStep(j, { kind: 'confirm', driverId: 'd2' }, OFFER + 1))).toBe('booked_job_not_found');
    j = bookedStep(j, { kind: 'pass', driverId: 'fav' }, OFFER + 60_000);
    expect(j).toMatchObject({ openedAt: OFFER + 60_000, passedBy: ['fav'] });
    expect(openTo(j, 'd2', OFFER + 60_000)).toBe(true);
    expect(openTo(j, 'fav', OFFER + 60_000)).toBe(false);
  });

  it('after his hour it opens to all (once)', () => {
    let j = bookedStep(job('fav'), { kind: 'open' }, OFFER);
    j = bookedStep(j, { kind: 'open_to_all' }, OFFER + H);
    expect(j.openedAt).toBe(OFFER + H);
    expect(bookedStep(j, { kind: 'open_to_all' }, OFFER + 2 * H)).toBe(j);
    expect(openTo(j, 'd2', OFFER + H)).toBe(true);
  });

  it('only the holder may release or start it', () => {
    const j = bookedStep(bookedStep(job(), { kind: 'open' }, OFFER), { kind: 'confirm', driverId: 'd1' }, OFFER);
    expect(code(() => bookedStep(j, { kind: 'release', driverId: 'd2' }, OFFER))).toBe('booked_job_not_found');
    expect(code(() => bookedStep(j, { kind: 'start', driverId: 'd2' }, OFFER))).toBe('booked_job_not_found');
  });

  it('cancelled from any open state; a started job is the trip’s now', () => {
    expect(bookedStep(job(), { kind: 'cancel' }, OFFER).state).toBe('cancelled');
    const started = bookedStep(bookedStep(bookedStep(job(), { kind: 'open' }, OFFER), { kind: 'confirm', driverId: 'd1' }, OFFER), { kind: 'start', driverId: 'd1' }, T);
    expect(bookedStep(started, { kind: 'cancel' }, T).state).toBe('started');
  });

  it('nothing is offered before its time or after its deadline', () => {
    const j = bookedStep(job(), { kind: 'open' }, OFFER);
    expect(openTo(j, 'd1', OFFER - 1)).toBe(false);
    expect(openTo(j, 'd1', DEADLINE)).toBe(false);
    expect(riderState(null)).toBe('later');
  });
});
