import { describe, expect, it } from 'vitest';
import { WAVE_RULES, type Actor } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryAccessRepository } from './access.repository.js';
import { ACCESS_OPENED_EVENT, AccessService, type AccessSources } from './access.service.js';

const ZONES = new Map([
  ['hussein', 'حي الحسين'],
  ['askari', 'العسكري'],
]);

function harness() {
  const clock = new FakeClock('2026-11-14T15:00:00Z');
  const repo = new InMemoryAccessRepository();
  const zones = new Map<string, string | null>();
  const staff = new Set<string>();
  const ordered = new Set<string>();
  const emitted: Array<{
    type: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string | undefined;
  }> = [];
  const audits: Array<{ action: string; summaryAr: string }> = [];
  const src: AccessSources = {
    ownZone: async (id) => {
      const z = zones.get(id);
      return z ? { cityId: 'aziziyah', zoneKey: z } : null;
    },
    isStaff: async (id) => staff.has(id),
    hasOrdered: async (id) => ordered.has(id),
    zoneNames: () => ZONES,
    emit: async (_tx, e) => {
      emitted.push({ type: e.type, payload: e.payload, idempotencyKey: e.idempotencyKey });
    },
    audit: async (input) => {
      audits.push({ action: input.action, summaryAr: input.summaryAr });
    },
  };
  const access = new AccessService(repo, src, clock);
  const ops: Actor = {
    personId: 'ops1',
    roles: ['dispatcher'],
    sessionId: 's',
  } as unknown as Actor;
  const me = (personId: string): Actor =>
    ({ personId, roles: ['customer'], sessionId: `s-${personId}` }) as unknown as Actor;
  /** A new customer with a saved place in `zone` (or none), one minute after the previous one. */
  const join = async (personId: string, zone: string | null) => {
    zones.set(personId, zone);
    clock.advanceMinutes(1);
    return access.status(me(personId));
  };
  const opened = () =>
    emitted.filter((e) => e.type === ACCESS_OPENED_EVENT).map((e) => e.payload['personId']);
  return { clock, repo, zones, staff, ordered, emitted, audits, access, ops, me, join, opened };
}

describe('customer waves (W5)', () => {
  it('with no wave anywhere everyone is let in, with or without a place, and nobody is messaged', async () => {
    const h = harness();
    expect((await h.join('a', 'hussein')).state).toBe('open');
    expect((await h.join('b', null)).state).toBe('open');
    await expect(h.access.assertMayOrder('c')).resolves.toBeUndefined();
    expect(h.repo.rows.get('a')?.reason).toBe('open');
    expect(h.opened()).toEqual([]);
  });

  it('lets a zone in up to its open places, then the rest wait in order of joining', async () => {
    const h = harness();
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'hussein', openSlots: 2 });
    expect((await h.join('a', 'hussein')).state).toBe('open');
    expect((await h.join('b', 'hussein')).state).toBe('open');
    const c = await h.join('c', 'hussein');
    expect(c).toMatchObject({
      state: 'waiting',
      zoneKey: 'hussein',
      zoneNameAr: 'حي الحسين',
      ahead: 0,
    });
    expect((await h.join('d', 'hussein')).ahead).toBe(1);
    await expect(h.access.assertMayOrder('c')).rejects.toMatchObject({ code: 'waitlisted' });
    // another zone with no wave stays open
    expect((await h.join('e', 'askari')).state).toBe('open');
  });

  it('raising the number lets the longest-waiting in, oldest first, with one message each', async () => {
    const h = harness();
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'hussein', openSlots: 1 });
    for (const id of ['a', 'b', 'c', 'd']) await h.join(id, 'hussein');
    expect(h.opened()).toEqual([]);
    const view = await h.access.setSlots(h.ops, {
      cityId: 'aziziyah',
      zoneKey: 'hussein',
      openSlots: 3,
    });
    expect(view).toMatchObject({ openSlots: 3, admitted: 3, waiting: 1 });
    expect(h.opened()).toEqual(['b', 'c']);
    expect(h.emitted.find((e) => e.type === ACCESS_OPENED_EVENT)?.idempotencyKey).toBe(
      `${ACCESS_OPENED_EVENT}:b`,
    );
    expect((await h.access.status(h.me('b'))).state).toBe('open');
    expect((await h.access.status(h.me('d'))).ahead).toBe(0);
    expect(h.audits.map((a) => a.summaryAr)).toEqual([
      'دور حي الحسين: 1 زبون',
      'دور حي الحسين: 3 زبون',
    ]);
  });

  it('a newcomer never jumps the line while others wait, even when a place is free', async () => {
    const h = harness();
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'hussein', openSlots: 1 });
    await h.join('a', 'hussein');
    await h.join('b', 'hussein');
    // free the place by hand (as if a was never let in): a and b wait, a first
    h.repo.rows.set('a', { ...h.repo.rows.get('a')!, state: 'waiting', admittedAt: null });
    expect((await h.join('z', 'hussein')).state).toBe('waiting');
    expect(await h.access.sweep()).toBe(1);
    expect(h.opened()).toEqual(['a']);
  });

  it('lowering the number never puts anyone back in line', async () => {
    const h = harness();
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'hussein', openSlots: 2 });
    await h.join('a', 'hussein');
    await h.join('b', 'hussein');
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'hussein', openSlots: 0 });
    expect((await h.access.status(h.me('a'))).state).toBe('open');
    expect((await h.join('c', 'hussein')).state).toBe('waiting');
  });

  it('staff, partners and people who ordered before never wait', async () => {
    const h = harness();
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'hussein', openSlots: 0 });
    h.staff.add('courier');
    h.ordered.add('regular');
    expect((await h.join('courier', 'hussein')).state).toBe('open');
    expect((await h.join('regular', 'hussein')).state).toBe('open');
    expect(h.repo.rows.get('courier')?.reason).toBe('staff');
    expect(h.repo.rows.get('regular')?.reason).toBe('existing');
    expect((await h.join('new', 'hussein')).state).toBe('waiting');
  });

  it('without a saved place a person waits for a zone; saving one puts them in line keeping their date', async () => {
    const h = harness();
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'hussein', openSlots: 1 });
    await h.join('a', 'hussein');
    const early = await h.join('b', null);
    expect(early).toMatchObject({ state: 'needs_place', zoneKey: null });
    await h.join('c', 'hussein');
    h.zones.set('b', 'hussein');
    expect(await h.access.status(h.me('b'))).toMatchObject({
      state: 'waiting',
      ahead: 0,
      waitingSince: early.waitingSince,
    });
    expect((await h.access.waves({ cityId: 'aziziyah' })).waitingWithoutZone).toBe(0);
  });

  it('switching every wave off lets everyone in, those with no place too', async () => {
    const h = harness();
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'hussein', openSlots: 0 });
    await h.join('a', 'hussein');
    await h.join('b', null);
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'hussein', openSlots: null });
    expect(h.opened().sort()).toEqual(['a', 'b']);
    expect(h.repo.rows.get('a')).toMatchObject({ state: 'admitted', reason: 'open' });
    expect(h.audits.at(-1)?.summaryAr).toBe('فتح حي الحسين للكل (بلا دور)');
  });

  it('a sweep lets in at most admitPerSweep people per zone', async () => {
    const h = harness();
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'hussein', openSlots: 0 });
    for (let i = 0; i < WAVE_RULES.admitPerSweep + 5; i += 1)
      await h.join(`p${String(i).padStart(3, '0')}`, 'hussein');
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'hussein', openSlots: 10_000 });
    expect(h.opened()).toHaveLength(WAVE_RULES.admitPerSweep);
    expect(await h.access.sweep()).toBe(5);
  });

  it('refuses an unknown zone and lists every zone for the Console', async () => {
    const h = harness();
    await expect(
      h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'nowhere', openSlots: 5 }),
    ).rejects.toMatchObject({ code: 'control_invalid' });
    await h.access.setSlots(h.ops, { cityId: 'aziziyah', zoneKey: 'askari', openSlots: 1 });
    await h.join('a', 'askari');
    await h.join('b', 'askari');
    const v = await h.access.waves({ cityId: 'aziziyah' });
    expect(v.zones).toEqual([
      expect.objectContaining({ zoneKey: 'hussein', openSlots: null, admitted: 0, waiting: 0 }),
      expect.objectContaining({
        zoneKey: 'askari',
        name_ar: 'العسكري',
        openSlots: 1,
        admitted: 1,
        waiting: 1,
      }),
    ]);
  });
});
