import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { ConfigService } from '../config/index.js';
import { dispatchHarness, north } from './test-harness.js';
import { ZoneDirectory } from './zones.js';

describe('PresenceService', () => {
  it('online → nearby within a radius, nearest first', async () => {
    const h = dispatchHarness();
    await h.online('a', 1.2);
    await h.online('b', 0.3);
    await h.online('c', 4);
    expect((await h.presence.nearby('aziziyah', north(0), 1.5)).map((d) => d.presence.driverId)).toEqual(['b', 'a']);
    expect((await h.presence.nearby('aziziyah', north(0))).map((d) => d.presence.driverId)).toEqual(['b', 'a', 'c']);
  });

  it('a driver without a heartbeat for 90 s drops out; heartbeats keep them in', async () => {
    const h = dispatchHarness();
    await h.online('quiet', 0.2);
    await h.online('chatty', 0.3);
    for (let i = 0; i < 4; i += 1) {
      h.clock.advanceSeconds(30);
      await h.presence.heartbeat('chatty', north(0.3));
    }
    expect((await h.presence.nearby('aziziyah', north(0))).map((d) => d.presence.driverId)).toEqual(['chatty']);
    // A heartbeat after expiry is refused: the app must go online again.
    expect(await h.presence.heartbeat('quiet', north(0.2))).toBeNull();
  });

  it('resolves the zone from the position and restarts the camping clock on a zone change only', async () => {
    const h = dispatchHarness();
    const centre = AZIZIYAH_ZONES.find((z) => z.id === 'centre')!;
    const khamas = AZIZIYAH_ZONES.find((z) => z.id === 'khamas')!;
    const p = await h.online('d', 0, { at: centre });
    expect(p.zoneId).toBe('centre');
    h.clock.advanceMinutes(1);
    await h.presence.heartbeat('d', { lat: centre.lat + 0.0005, lng: centre.lng });
    h.clock.advanceMinutes(1);
    const still = await h.presence.heartbeat('d', centre);
    expect(still?.zoneSince).toBe(p.zoneSince);
    expect(h.presence.minutesInZone(still!)).toBe(2);
    h.clock.advanceMinutes(1);
    const moved = await h.presence.heartbeat('d', khamas);
    expect(moved?.zoneId).toBe('khamas');
    expect(h.presence.minutesInZone(moved!)).toBe(0);
  });

  it('remembers when the shift started across re-registrations and heartbeats; a new stretch starts after offline (Partner S-4)', async () => {
    const h = dispatchHarness();
    const first = await h.online('d', 0.1);
    expect(first.onlineSince).toBe(h.clock.now().getTime());
    for (let i = 0; i < 6; i += 1) {
      h.clock.advanceSeconds(30);
      await h.presence.heartbeat('d', north(0.2));
    }
    h.clock.advanceSeconds(30);
    const again = await h.online('d', 0.2); // the app's 30-s beat re-sends goOnline
    expect(again.onlineSince).toBe(first.onlineSince);
    // Gone quiet past the 90-s presence: the next go-online is a new stretch, like going offline.
    h.clock.advanceMinutes(5);
    expect((await h.online('d', 0.2)).onlineSince).toBe(h.clock.now().getTime());
    await h.presence.offline('d');
    h.clock.advanceMinutes(5);
    const next = await h.online('d', 0.2);
    expect(next.onlineSince).toBe(h.clock.now().getTime());
  });

  it('offline removes the driver at once', async () => {
    const h = dispatchHarness();
    await h.online('d', 0.1);
    await h.presence.offline('d');
    expect(await h.presence.nearby('aziziyah', north(0))).toEqual([]);
  });
});

describe('ZoneDirectory', () => {
  const zones = new ZoneDirectory(new ConfigService());

  it('knows tiers from the city config', () => {
    expect(zones.tier('aziziyah', 'centre')).toBe('centre');
    expect(zones.isEdge('aziziyah', 'bazl_hallata')).toBe(true);
    expect(zones.isEdge('aziziyah', 'khamas')).toBe(false);
  });

  it('adjacency: same zone, same named group, or touching draft circles', () => {
    expect(zones.adjacent('aziziyah', 'centre', 'centre')).toBe(true);
    expect(zones.adjacent('aziziyah', 'centre', 'street_30')).toBe(true);
    expect(zones.adjacent('aziziyah', 'hawas_tujjar', 'hawas_umm_banin')).toBe(true);
    expect(zones.adjacent('aziziyah', 'centre', 'khamas')).toBe(false);
    expect(zones.adjacent('aziziyah', 'deir', 'khamas_rasool')).toBe(false);
  });
});
