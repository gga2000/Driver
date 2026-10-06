import { describe, expect, it } from 'vitest';
import { DriverError, NUDGE_RULES, type DispatchBoard, type LatLng } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { ConfigService } from '../config/index.js';
import { RecordingEventEmitter } from './events.adapter.js';
import { offsetPin } from './geo.js';
import { InMemoryGeoIndex } from './geo-index.js';
import { PresenceService } from './presence.service.js';
import { ZoneDemandService } from './zone-demand.service.js';
import { ZoneDirectory } from './zones.js';

function setup(waitingZones: string[] = []) {
  const clock = new FakeClock(new Date('2026-10-06T18:00:00Z'));
  const zones = new ZoneDirectory(new ConfigService());
  const presence = new PresenceService(new InMemoryGeoIndex(() => clock.now()), zones, clock);
  const busy = new Set<string>();
  const events = new RecordingEventEmitter();
  const board = { cityId: 'aziziyah', at: clock.now(), policies: [], cards: waitingZones.map((zoneId, i) => ({ tripId: `t${i}`, zoneId, status: 'searching' })) } as unknown as DispatchBoard;
  const svc = new ZoneDemandService(presence, { board: async () => board, idle: async (id) => !busy.has(id) }, { pickupsByZone: async () => new Map([['zakur', 8]]) }, zones, events, clock);
  const centre = zones.centre('aziziyah', 'centre')!;
  const online = (id: string, at: LatLng) => presence.online(id, { cityId: 'aziziyah', at, vehicle: 'bike', tier: 'silver' });
  return { clock, svc, busy, events, centre, online };
}

describe('ZoneDemandService (maps program o5)', () => {
  it('busy zones: waiting now, the usual for this hour (4-week average), drivers there', async () => {
    const s = setup(['centre', 'centre', 'centre']);
    await s.online('d1', s.centre);
    const m = await s.svc.demand('aziziyah');
    expect(m.zones.find((z) => z.zoneId === 'centre')).toMatchObject({ waiting: 3, drivers: 1, level: 'hot' });
    // 8 pickups in each of the 4 windows → 8 on average.
    expect(m.zones.find((z) => z.zoneId === 'zakur')).toMatchObject({ expected: 8, level: 'hot' });
  });

  it('"send drivers here": free drivers around the zone, not those already in it, then a 10-minute pause', async () => {
    const s = setup(['centre']);
    await s.online('inside', s.centre);
    await s.online('near', offsetPin(s.centre, 1500, 90));
    await s.online('busy', offsetPin(s.centre, 1200, 180));
    await s.online('far', offsetPin(s.centre, (NUDGE_RULES.radiusKm + 2) * 1000, 0));
    s.busy.add('busy');
    const out = await s.svc.nudge('disp', { cityId: 'aziziyah', zoneId: 'centre' });
    expect(out.sent).toBe(1);
    const ev = s.events.events.at(-1)!;
    expect(ev).toMatchObject({ type: 'dispatch.zone_nudged', payload: { zoneId: 'centre', driverIds: ['near'] } });
    const again = await s.svc.nudge('disp', { cityId: 'aziziyah', zoneId: 'centre' }).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(DriverError);
    expect((again as DriverError).code).toBe('nudge_too_soon');
    s.clock.advance(NUDGE_RULES.cooldownMin * 60_000);
    // Presence lives 90 s without a heartbeat: he is still around and still reporting.
    await s.online('near', offsetPin(s.centre, 1500, 90));
    expect((await s.svc.nudge('disp', { cityId: 'aziziyah', zoneId: 'centre' })).sent).toBe(1);
  });
});
