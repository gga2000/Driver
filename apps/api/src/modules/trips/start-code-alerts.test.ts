import { describe, expect, it } from 'vitest';
import { DriverError, START_CODE_RULES, StartCodeAlert } from '@driver/contracts';
import { PINS, tripsHarness } from './test-harness.js';
import { TripsRpc } from './trips.rpc.js';

/** s1: the Console safety strip's row when a night ride's code is typed wrong 5 times on one pickup. */
async function setup() {
  const h = tripsHarness('2026-10-03T19:30:00Z');
  h.trips.bindStartCodes({ codeOf: async (orderId) => (orderId === 'ord_1' ? '4821' : null) });
  const reads: Array<{ ids: readonly string[]; accessor: string; purpose: string | undefined }> = [];
  const rpc = new TripsRpc(
    h.trips,
    { hasRole: async () => true },
    { childNamesForRunSheet: async () => ({}) },
    {
      memberCards: async (ids, accessor, purpose) => {
        reads.push({ ids, accessor, purpose });
        return Object.fromEntries(ids.map((id) => [id, { name: 'حيدر كاظم علي', phoneMasked: '+96477*****01' }]));
      },
    },
  );
  const t = await h.acceptedTrip('ord_1', 'd1', { vertical: 'taxi', vehicleClass: 'car' });
  const pickup = t.stops.find((s) => s.type === 'pickup')!;
  await h.trips.arrive(t.id, pickup.id, 'd1', { pin: PINS.kitchen });
  const wrong = async () => {
    const err = await h.trips.completeStop(t.id, pickup.id, 'd1', { startCode: '1357' }).then(() => null, (e: unknown) => e);
    expect((err as DriverError).code).toBe('start_code_wrong');
  };
  return { h, rpc, t, pickup, reads, wrong };
}

const ops = { personId: 'ops_1', sessionId: 's' };

describe('trips.startCodeAlerts (ride step 3, s1)', () => {
  it('nothing below the threshold', async () => {
    const { rpc, wrong } = await setup();
    for (let i = 0; i < START_CODE_RULES.wrongAlertAt - 1; i++) await wrong();
    expect(await rpc.startCodeAlerts(ops, { cityId: 'aziziyah' })).toEqual([]);
  });

  it('one row at the threshold, with the driver’s short name (a logged read), never the code; calm once the rider got in', async () => {
    const { h, rpc, t, pickup, reads, wrong } = await setup();
    for (let i = 0; i < START_CODE_RULES.wrongAlertAt; i++) await wrong();
    const [row, ...rest] = await rpc.startCodeAlerts(ops, { cityId: 'aziziyah' });
    expect(rest).toEqual([]);
    expect(StartCodeAlert.parse(row)).toEqual(row);
    expect(row).toMatchObject({ alertId: pickup.id, orderId: 'ord_1', tripId: t.id, vertical: 'taxi', wrongCount: 5, startedAt: null, driver: { personId: 'd1', displayName: 'حيدر ك.', phoneMasked: '+96477*****01' } });
    expect(reads).toEqual([{ ids: ['d1'], accessor: 'ops_1', purpose: 'ride_start_code_alert' }]);
    expect(JSON.stringify(row)).not.toContain('4821');
    await h.trips.completeStop(t.id, pickup.id, 'd1', { startCode: '4821' });
    const [after] = await rpc.startCodeAlerts(ops, { cityId: 'aziziyah' });
    expect(after!.startedAt).not.toBeNull();
  });
});
