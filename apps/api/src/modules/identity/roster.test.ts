import { describe, expect, it } from 'vitest';
import type { RoleKind } from '@driver/contracts';
import { harness } from './test-harness.js';

const DRIVING: RoleKind[] = ['courier', 'driver', 'intercity_driver', 'khat_driver'];
const SYSTEM = { personId: 'system' };

async function people() {
  const h = harness();
  const ids: string[] = [];
  for (const [i, kinds] of [[1, ['courier']], [2, ['driver', 'khat_driver']], [3, []], [4, ['intercity_driver']], [5, ['courier']]] as const) {
    const { personId } = await h.login(`0771234000${i}`);
    for (const kind of kinds) await h.service.grantRole(SYSTEM, { personId, kind });
    ids.push(personId);
  }
  return { h, ids };
}

describe('IdentityService.roster (narrow port for the Console drivers list)', () => {
  it('lists people with a driving role, by id, with only those roles, and pages with a cursor', async () => {
    const { h, ids } = await people();
    const drivers = [ids[0]!, ids[1]!, ids[3]!, ids[4]!].sort();
    const first = await h.service.roster({ kinds: DRIVING, limit: 3 });
    expect(first.total).toBe(4);
    expect(first.rows.map((r) => r.personId)).toEqual(drivers.slice(0, 3));
    expect(first.nextCursor).toBe(drivers[2]);
    const second = await h.service.roster({ kinds: DRIVING, limit: 3, cursor: first.nextCursor! });
    expect(second.rows.map((r) => r.personId)).toEqual([drivers[3]]);
    expect(second.nextCursor).toBeNull();

    const two = [...first.rows, ...second.rows].find((r) => r.personId === ids[1])!;
    expect(two.roles).toEqual(['driver', 'khat_driver']);
    expect(two).toMatchObject({ frozen: false, trustTier: 'new' });
    expect(two.joinedAt).toBeInstanceOf(Date);
  });

  it('filters by role and id substring; frozen grants show; revoked grants drop out', async () => {
    const { h, ids } = await people();
    expect((await h.service.roster({ kinds: ['courier'], limit: 10 })).rows.map((r) => r.personId).sort()).toEqual([ids[0], ids[4]].sort());
    expect((await h.service.roster({ kinds: DRIVING, limit: 10, q: ids[3]!.toUpperCase() })).rows.map((r) => r.personId)).toEqual([ids[3]]);

    await h.repo.setRolesFrozen(ids[0]!, ['courier'], new Date());
    expect((await h.service.roster({ kinds: ['courier'], limit: 10 })).rows.find((r) => r.personId === ids[0])?.frozen).toBe(true);

    await h.service.revokeRole(SYSTEM, { personId: ids[4]!, kind: 'courier' });
    expect((await h.service.roster({ kinds: DRIVING, limit: 10 })).total).toBe(3);
  });

  it('never reads the vault', async () => {
    const { h } = await people();
    const before = h.repo.accessLogs.length;
    await h.service.roster({ kinds: DRIVING, limit: 10 });
    expect(h.repo.accessLogs.length).toBe(before);
  });

  it('rosterEntry: one person, null without a driving role', async () => {
    const { h, ids } = await people();
    expect(await h.service.rosterEntry(ids[1]!, DRIVING)).toMatchObject({ personId: ids[1], roles: ['driver', 'khat_driver'] });
    expect(await h.service.rosterEntry(ids[2]!, DRIVING)).toBeNull();
    expect(await h.service.rosterEntry('nobody', DRIVING)).toBeNull();
  });

  it('matchDisplayNames: folded match on the display name only; logs a read for each match, none for misses', async () => {
    const { h, ids } = await people();
    await h.service.updateProfile({ personId: ids[0]!, sessionId: 's' }, { name: 'حيدر كاظم جواد' });
    await h.service.updateProfile({ personId: ids[1]!, sessionId: 's' }, { name: 'حيدره علي' });
    await h.service.updateProfile({ personId: ids[3]!, sessionId: 's' }, { name: 'سجاد الربيعي' });
    const before = h.repo.accessLogs.length;
    const match = (q: string) => h.service.matchDisplayNames([ids[0]!, ids[1]!, ids[3]!, ids[4]!], q, 'p_staff', 'console_driver_search');
    expect((await match('حيدر')).sort()).toEqual([ids[0], ids[1]].sort());
    expect(h.repo.accessLogs.slice(before).map((l) => [l.personId, l.accessorId, l.purpose])).toEqual(
      expect.arrayContaining([[ids[0], 'p_staff', 'console_driver_search'], [ids[1], 'p_staff', 'console_driver_search']]),
    );
    expect(h.repo.accessLogs.length - before).toBe(2);
    // "حيدرة" folds to "حيدره"; "حيدر ك" narrows to the one with that initial.
    expect(await match('حيدرة')).toEqual([ids[1]]);
    expect(await match('حيدر ك')).toEqual([ids[0]]);
    // The family name is never matched (only "سجاد ر." is shown to staff).
    expect(await match('الربيعي')).toEqual([]);
    expect(await match('سجاد')).toEqual([ids[3]]);
    expect(await match('  ')).toEqual([]);
  });
});
