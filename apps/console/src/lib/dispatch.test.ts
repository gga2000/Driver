import { describe, expect, it } from 'vitest';
import {
  buildQueue,
  capShare,
  DESK_START,
  deskKey,
  distanceKm,
  etaMinutes,
  merchantOfTrip,
  pickupOf,
  queueOrder,
  rankCandidates,
  triage,
  vehicleFit,
  waitTone,
  waveHistory,
  type DeskContext,
  type DeskKey,
  type DeskState,
} from './dispatch';
import { card, offer, pin, stop, trip } from './fixtures';

const PICKUP = { lat: 32.905, lng: 45.06 };
/** ~0.01° of latitude ≈ 1.11 km. */
const north = (km: number) => ({ lat: PICKUP.lat + km / 111.2, lng: PICKUP.lng });

describe('queue', () => {
  it('puts the cards that need a human first and the assigned ones last', () => {
    const q = buildQueue([
      card({ tripId: 'assigned', status: 'assigned', assignedDriverId: 'd1' }),
      card({ tripId: 'search' }),
      card({ tripId: 'needs-new', status: 'needs_dispatcher', elapsedSec: 60 }),
      card({ tripId: 'needs-old', status: 'needs_dispatcher', elapsedSec: 400 }),
      card({ tripId: 'offered', offers: [offer({ driverId: 'd2' })] }),
      card({ tripId: 'gone', status: 'cancelled' }),
    ]);
    expect(queueOrder(q)).toEqual(['needs-old', 'needs-new', 'offered', 'search', 'assigned']);
    expect(queueOrder(q, new Set(['assigned']))).not.toContain('assigned');
    const tri = triage(q);
    expect(tri.needs).toBe(2);
    expect(tri.oldest?.tripId).toBe('needs-old');
  });

  it('turns the wait clock amber after 3 minutes and red when the card needs a dispatcher', () => {
    expect(waitTone(card({ tripId: 'a' }), 30)).toBe('neutral');
    expect(waitTone(card({ tripId: 'a' }), 200)).toBe('warn');
    expect(waitTone(card({ tripId: 'a', status: 'needs_dispatcher' }), 5)).toBe('bad');
    expect(waitTone(card({ tripId: 'a', status: 'assigned', red: true }), 900)).toBe('neutral');
    expect(waitTone(card({ tripId: 'a', status: 'scheduled' }), 1900)).toBe('neutral');
  });

  it('reads the wave history from the offers', () => {
    const h = waveHistory(
      card({
        tripId: 'w',
        wave: 2,
        offers: [offer({ driverId: 'a', state: 'declined' }), offer({ driverId: 'b', state: 'timed_out' }), offer({ driverId: 'c', state: 'seen' })],
      }),
    );
    expect(h).toEqual({ current: 2, total: 3, declined: 1, timedOut: 1, open: 1 });
    expect(waveHistory(card({ tripId: 'p', policy: 'auto_assign', wave: 0, pass: 4 })).total).toBe(4);
  });
});

describe('geometry', () => {
  it('measures km and turns them into town minutes', () => {
    expect(distanceKm(PICKUP, north(2))).toBeCloseTo(2, 1);
    expect(etaMinutes(2, 'bike')).toBe(7); // 2 km × 1.3 road ÷ 24 km/h
    expect(etaMinutes(0.05, 'car')).toBe(1);
  });

  it('finds the pickup stop of a trip', () => {
    const t = trip({ id: 't', stops: [stop({ id: 'b', seq: 1, type: 'dropoff', target: north(3) }), stop({ id: 'a', seq: 0, type: 'pickup', target: PICKUP })] });
    expect(pickupOf(t)).toEqual(PICKUP);
    expect(pickupOf(undefined)).toBeNull();
  });

  it('knows which vehicles can take which job', () => {
    expect(vehicleFit('food', 'bike')).toBe(1);
    expect(vehicleFit('taxi', 'bike')).toBe(0);
    expect(vehicleFit('tuktuk', 'tuktuk')).toBe(1);
  });
});

describe('candidate ranking (K-04)', () => {
  const food = card({ tripId: 't1', status: 'needs_dispatcher' });

  it('ranks by distance, tier, load and vehicle fit, nearest free driver first', () => {
    const list = rankCandidates(food, PICKUP, [
      pin({ driverId: 'far-gold', ...north(4), tier: 'gold' }),
      pin({ driverId: 'near', ...north(0.5) }),
      pin({ driverId: 'near-busy', ...north(0.4), state: 'on_job', tripId: 'x' }),
      pin({ driverId: 'mid-gold', ...north(1.5), tier: 'gold' }),
    ]);
    // 0.4·distance + 0.3·tier + 0.2·load + 0.1·fit: a free gold driver 4 km out still beats a busy one next door.
    expect(list.map((c) => c.driverId)).toEqual(['mid-gold', 'near', 'far-gold', 'near-busy']);
    expect(list[1]!.km).toBeCloseTo(0.5, 1);
    expect(list[1]!.etaMin).toBe(2);
    expect(list.every((c) => c.score >= 0 && c.score <= 100)).toBe(true);
  });

  it('puts drivers that need force (over cap, offline, wrong vehicle) after the others and says why', () => {
    const list = rankCandidates(card({ tripId: 'taxi', vertical: 'taxi' }), PICKUP, [
      pin({ driverId: 'bike', ...north(0.1), vehicleClass: 'bike', tier: 'gold' }),
      pin({ driverId: 'car-over', ...north(0.2), vehicleClass: 'car', overCap: true, state: 'over_cap', owedIqd: 90_000 }),
      pin({ driverId: 'car', ...north(3), vehicleClass: 'car' }),
      pin({ driverId: 'car-gone', ...north(0.3), vehicleClass: 'car', state: 'offline_recent' }),
    ]);
    expect(list[0]!.driverId).toBe('car');
    expect(list[0]!.blockers).toEqual([]);
    expect(Object.fromEntries(list.slice(1).map((c) => [c.driverId, c.blockers]))).toEqual({
      bike: ['vehicle'],
      'car-over': ['over_cap'],
      'car-gone': ['offline'],
    });
  });

  it('lifts server suggestions, sinks drivers who already declined, skips the assigned one, caps at 5', () => {
    const c = card({
      tripId: 't',
      suggestion: ['s1', 'ghost'],
      assignedDriverId: 'mine',
      offers: [offer({ driverId: 'nope', state: 'declined' })],
    });
    const pins = [pin({ driverId: 's1', ...north(1) }), pin({ driverId: 'nope', ...north(1) }), pin({ driverId: 'mine', ...north(0.1) }), pin({ driverId: 'x', ...north(1) })];
    const list = rankCandidates(c, PICKUP, pins);
    expect(list.map((x) => x.driverId)).toEqual(['s1', 'x', 'nope', 'ghost']);
    expect(list[0]!.suggested).toBe(true);
    expect(list[2]!.declined).toBe(true);
    expect(list[3]).toMatchObject({ pin: null, blockers: ['offline'], suggested: true });
    const many = Array.from({ length: 9 }, (_, i) => pin({ driverId: `d${i}`, ...north(i * 0.3) }));
    expect(rankCandidates(food, PICKUP, many)).toHaveLength(5);
  });

  it('still ranks without a pickup position (distance counts as neutral)', () => {
    const list = rankCandidates(food, null, [pin({ driverId: 'a', tier: 'gold' }), pin({ driverId: 'b' })]);
    expect(list.map((c) => c.driverId)).toEqual(['a', 'b']);
    expect(list[0]!.km).toBeNull();
    expect(list[0]!.etaMin).toBeNull();
  });

  it('reads cash against the cap as a share that can pass 100', () => {
    expect(capShare({ owedIqd: 34_900, capIqd: 75_000 })).toBe(47);
    expect(capShare({ owedIqd: 90_000, capIqd: 75_000 })).toBe(120);
    expect(capShare({ owedIqd: 5, capIqd: 0 })).toBe(0);
  });

  it('finds the restaurant from the orders on the trip', () => {
    const orders = new Map([
      ['o1', { merchantOrgId: null }],
      ['o2', { merchantOrgId: 'org-khalid' }],
    ]);
    expect(merchantOfTrip(['o1', 'o2'], orders)).toBe('org-khalid');
    expect(merchantOfTrip([], orders)).toBeNull();
  });
});

describe('desk keys (K-07)', () => {
  const ctx: DeskContext = { order: ['a', 'b', 'c'], oldest: 'b', candidates: 3, assignable: true };
  const run = (keys: DeskKey[], c: DeskContext = ctx, from: DeskState = DESK_START) => {
    let s = from;
    const effects: string[] = [];
    for (const k of keys) {
      const r = deskKey(s, k, c);
      s = r.state;
      if (r.effect) effects.push(r.effect);
    }
    return { s, effects };
  };

  it('j / k walk the queue and clamp at the ends', () => {
    expect(run(['j']).s.selected).toBe('a');
    expect(run(['j', 'j', 'j', 'j']).s.selected).toBe('c');
    expect(run(['k']).s.selected).toBe('c');
    expect(run(['j', 'j', 'k']).s.selected).toBe('a');
  });

  it('a takes the oldest card that needs a dispatcher', () => {
    expect(run(['a']).s).toEqual({ selected: 'b', pick: -1 });
    expect(run(['a'], { ...ctx, oldest: null }).s).toEqual(DESK_START);
  });

  it('1–5 pick a candidate and Enter sends; Enter alone never sends', () => {
    expect(run(['a', 'enter']).effects).toEqual([]);
    const r = run(['a', '2', 'enter']);
    expect(r.s.pick).toBe(1);
    expect(r.effects).toEqual(['send']);
    expect(run(['a', '5']).s.pick).toBe(-1); // only 3 candidates
    expect(run(['2']).s.pick).toBe(-1); // nothing selected
    expect(run(['a', '1', 'enter'], { ...ctx, assignable: false }).effects).toEqual([]);
  });

  it('moving to another card drops the pick', () => {
    expect(run(['a', '1', 'j']).s).toEqual({ selected: 'c', pick: -1 });
  });

  it('Enter with nothing selected selects the first card; Esc unwinds pick, then selection', () => {
    expect(run(['enter']).s.selected).toBe('a');
    expect(run(['a', '1', 'escape']).s).toEqual({ selected: 'b', pick: -1 });
    expect(run(['a', '1', 'escape', 'escape']).s).toEqual(DESK_START);
  });
});
