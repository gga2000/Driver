import { describe, expect, it } from 'vitest';
import { AUTO_ARRIVE, dismissArrival, NO_WATCH, watchArrival, type ArriveInput, type ArriveWatch } from './arrive';

const at = (now: number, over: Partial<ArriveInput> = {}): ArriveInput => ({ stopId: 's1', pending: true, armed: new Set(['s1']), speedKmh: 3, now, ...over });
function run(steps: ArriveInput[], start: ArriveWatch = NO_WATCH) {
  let w = start;
  const asks: boolean[] = [];
  for (const s of steps) {
    const r = watchArrival(w, s);
    w = r.watch;
    asks.push(r.ask);
  }
  return { w, asks };
}

describe('auto-arrive (maps program d4)', () => {
  it('asks once he has been slow inside the stop’s 60 m for 10 s', () => {
    expect(run([at(0), at(5_000), at(AUTO_ARRIVE.stillMs)]).asks).toEqual([false, false, true]);
  });

  it('driving past (fast) never asks; slowing down starts the clock', () => {
    expect(run([at(0, { speedKmh: 30 }), at(12_000, { speedKmh: 25 })]).asks).toEqual([false, false]);
    expect(run([at(0, { speedKmh: 30 }), at(5_000), at(14_000), at(15_000)]).asks).toEqual([false, false, false, true]);
  });

  it('not armed, not this stop, or already arrived: no question', () => {
    expect(run([at(0, { armed: new Set() }), at(20_000, { armed: new Set() })]).asks).toEqual([false, false]);
    expect(run([at(0, { armed: new Set(['s2']) }), at(20_000, { armed: new Set(['s2']) })]).asks).toEqual([false, false]);
    expect(run([at(0, { pending: false }), at(20_000, { pending: false })]).asks).toEqual([false, false]);
  });

  it('"مو بعد" holds until he leaves the geofence; coming back asks again', () => {
    const asked = run([at(0), at(10_000)]);
    const later = run([at(20_000), at(40_000)], dismissArrival(asked.w, 's1'));
    expect(later.asks).toEqual([false, false]);
    const back = run([at(50_000, { armed: new Set() }), at(60_000), at(70_000)], later.w);
    expect(back.asks).toEqual([false, false, true]);
  });

  it('unknown speed counts as slow', () => {
    expect(run([at(0, { speedKmh: null }), at(10_000, { speedKmh: null })]).asks).toEqual([false, true]);
  });
});
