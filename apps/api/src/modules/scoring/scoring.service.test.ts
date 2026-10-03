import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { createInMemoryEvents } from '../events/index.js';
import { ScoringService } from './scoring.service.js';

const DAY = 86_400_000;

/** Tier for cash caps (scoring §2: observation days 1–30 at 75k; Gold needs ≥ 85 and ≥ 100 trips). */
describe('ScoringService.capTier', () => {
  function setup() {
    const clock = new FakeClock('2026-10-03T09:00:00Z');
    const { events } = createInMemoryEvents({ clock, contradictions: false });
    const scoring = new ScoringService(events);
    const act = async (driverId: string, type: string, n = 1) => {
      for (let i = 0; i < n; i++) await events.emit(undefined, { type, actorId: driverId, occurredAt: clock.now() }, { name: 'trip', id: `t${i}` });
    };
    return { clock, scoring, act };
  }

  it('no scorecard (never active) → null, so the ledger defaults to bronze', async () => {
    const { scoring } = setup();
    expect(await scoring.capTier('nobody')).toBeNull();
  });

  it('observation period (first 30 days) is bronze whatever the index', async () => {
    const { scoring, act, clock } = setup();
    await act('d1', 'trip.completed', 120);
    expect(await scoring.capTier('d1', clock.now())).toBe('bronze');
  });

  it('after observation: the index tier, but Gold only with ≥ 100 completed trips', async () => {
    const { scoring, act, clock } = setup();
    await act('d1', 'trip.completed', 40);
    await act('d2', 'trip.completed', 100);
    const later = new Date(clock.now().getTime() + 31 * DAY);
    expect(await scoring.capTier('d1', later)).toBe('silver');
    expect(await scoring.capTier('d2', later)).toBe('gold');
  });
});
