import { describe, expect, it } from 'vitest';
import { InMemoryTimerStore, TIMER_SWEEP_GRACE_MS, TimerSweeper } from '../../shared/timers/index.js';
import { RIDE_AUTOCOMPLETE_AFTER_MS } from './trips.service.js';
import { PINS, tripsHarness } from './test-harness.js';

/**
 * Edge-case review B.24: no driver update for 10 minutes inside the drop-off geofence completes the
 * ride. The trip has one durable timer for it, armed by the first fix inside and re-armed by itself,
 * not a row per position fix.
 */
async function rideAtDropoff() {
  const h = tripsHarness();
  const store = new InMemoryTimerStore();
  const sweeper = new TimerSweeper(store, h.clock, 'all', { enabled: false, intervalMs: 5_000, batch: 50, leaseMs: 60_000 });
  h.trips.bindDurableTimers(store, sweeper);
  const t = await h.acceptedTrip('ord_1', 'd1', { vertical: 'taxi', vehicleClass: 'car' });
  await h.repo.updateTrip(t.id, { state: 'in_transit' }, h.clock.now());
  const ping = (pin = PINS.home) => h.trips.reportPosition('d1', { tripId: t.id, pin, at: h.clock.now() });
  const rows = () => store.rows.filter((r) => r.queue === 'trips.timers' && r.name === 'ride.autoComplete');
  const state = async () => (await h.trips.get(t.id)).state;
  return { h, t, store, sweeper, ping, rows, state };
}

describe('ride auto-complete (B.24)', () => {
  it('a driver waiting at the drop-off writes one timer, and the ride completes 10 minutes after his last fix', async () => {
    const { h, ping, rows, state } = await rideAtDropoff();
    for (let i = 0; i < 11; i++) {
      await ping();
      if (i < 10) await h.advance(30_000);
    }
    expect(rows()).toHaveLength(1);
    expect(h.queue.size).toBe(1);

    await h.advance(RIDE_AUTOCOMPLETE_AFTER_MS - 1_000);
    expect(await state()).toBe('in_transit');
    expect(rows()).toHaveLength(1);
    await h.advance(1_000);
    expect(await state()).toBe('completed');
    expect(h.events.events.find((e) => e.type === 'trip.completed')?.payload).toMatchObject({ by: 'system', reason: 'auto_dropoff_geofence_10min' });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.status).toBe('fired');
  });

  it('a driver who drives off is not completed; back inside, the same timer arms again', async () => {
    const { h, ping, rows, state } = await rideAtDropoff();
    await ping();
    await h.advance(60_000);
    await ping(PINS.kitchen); // left the drop-off
    await h.advance(RIDE_AUTOCOMPLETE_AFTER_MS);
    expect(await state()).toBe('in_transit');
    expect(rows()[0]!.status).toBe('fired');

    await ping();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.status).toBe('pending');
    await h.advance(RIDE_AUTOCOMPLETE_AFTER_MS);
    expect(await state()).toBe('completed');
  });

  it('with its Redis job lost, the sweeper still completes the ride, a minute late', async () => {
    const { h, sweeper, ping, state } = await rideAtDropoff();
    await ping();
    await h.queue.close();
    await h.advance(RIDE_AUTOCOMPLETE_AFTER_MS);
    expect(await state()).toBe('in_transit');
    h.clock.advance(TIMER_SWEEP_GRACE_MS);
    expect((await sweeper.sweep()).fired).toBe(1);
    expect(await state()).toBe('completed');
  });
});
