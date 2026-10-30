import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import type { IdentityService } from '../identity/index.js';
import { AuditLogService, auditCursor, parseAuditCursor, StaffNames } from './audit.js';
import { InMemoryControlsRepository } from './controls.repository.js';

function harness() {
  const clock = new FakeClock('2026-10-09T09:00:00Z');
  const repo = new InMemoryControlsRepository();
  const identity = { firstNamesFor: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, 'علي'])) } as unknown as IdentityService;
  const audits = new AuditLogService(repo, new StaffNames(identity, clock), clock);
  const add = async (action: string, cityId: string | null = 'aziziyah') => {
    clock.advance(1_000);
    return audits.record({ cityId, actorId: 'p_ali', action, subjectKind: 'x', subjectId: action, summaryAr: action });
  };
  return { audits, add, clock };
}

describe('audit page (v10)', () => {
  it('pages newest first with a cursor and counts every matching row', async () => {
    const { audits, add } = harness();
    for (let i = 0; i < 5; i++) await add(`zone.renamed`);
    const first = await audits.page({ cityId: 'aziziyah', limit: 2 });
    expect(first.total).toBe(5);
    expect(first.rows).toHaveLength(2);
    expect(first.rows[0]!.at.getTime()).toBeGreaterThan(first.rows[1]!.at.getTime());
    const second = await audits.page({ cityId: 'aziziyah', limit: 2, cursor: first.nextCursor! });
    const third = await audits.page({ cityId: 'aziziyah', limit: 2, cursor: second.nextCursor! });
    const ids = [...first.rows, ...second.rows, ...third.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(5);
    expect(third.rows).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
  });

  it('narrows to a chip by action and leaves other cities out', async () => {
    const { audits, add } = harness();
    await add('ticket.refund');
    await add('refund_approval.approved');
    await add('driver.pause');
    await add('ticket.refund', 'kut');
    await add('banner.set', null);
    const money = await audits.page({ cityId: 'aziziyah', category: 'money', limit: 50 });
    expect(money.rows.map((r) => r.action)).toEqual(['refund_approval.approved', 'ticket.refund']);
    expect(money.total).toBe(2);
    const pauses = await audits.page({ cityId: 'aziziyah', category: 'pauses', limit: 50 });
    expect(pauses.rows.map((r) => r.action)).toEqual(['driver.pause']);
    const all = await audits.page({ cityId: 'aziziyah', limit: 50 });
    expect(all.total).toBe(4);
  });

  it('reads a foreign cursor as the first page', () => {
    expect(parseAuditCursor('nonsense')).toBeUndefined();
    expect(parseAuditCursor('notadate~au_1')).toBeUndefined();
    const at = new Date('2026-10-09T09:00:00Z');
    expect(parseAuditCursor(auditCursor({ at, id: 'au_7' }))).toEqual({ at, id: 'au_7' });
  });
});
