import { afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaConsoleWatchRepository } from './console-watch.repository.js';
import { PrismaHandoverRepository } from './handover.repository.js';
import { PrismaOnCallRepository } from './on-call.repository.js';

const url = process.env['DATABASE_URL'];
const CITY = `oncall_it_${Date.now()}`;

describe.skipIf(!url)('on call on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaOnCallRepository(prisma);
  const watch = new PrismaConsoleWatchRepository(prisma);
  const handovers = new PrismaHandoverRepository(prisma);
  const alerts: string[] = [];

  afterAll(async () => {
    await prisma.prisma
      .$executeRaw`DELETE FROM "public"."on_call_shifts" WHERE "city_id" = ${CITY}`;
    await prisma.prisma
      .$executeRaw`DELETE FROM "public"."alert_ladders" WHERE "alert_id" = ANY(${alerts})`;
    await prisma.prisma
      .$executeRaw`DELETE FROM "public"."console_presence" WHERE "city_id" = ${CITY}`;
    await prisma.prisma
      .$executeRaw`DELETE FROM "public"."console_watch_alerts" WHERE "city_id" = ${CITY}`;
    await prisma.prisma
      .$executeRaw`DELETE FROM "public"."handover_notes" WHERE "city_id" = ${CITY}`;
    await prisma.onModuleDestroy();
  });

  it('keeps the roster: who is on call now, rank 1 first, ended shifts left out', async () => {
    const t = new Date('2026-10-09T21:00:00Z');
    const h = (n: number) => new Date(t.getTime() + n * 3_600_000);
    const two = await repo.addShift(
      {
        cityId: CITY,
        desk: 'sos',
        personId: 'p_omar',
        rank: 2,
        startsAt: h(-1),
        endsAt: h(8),
        createdById: 'p_ali',
      },
      t,
    );
    const one = await repo.addShift(
      {
        cityId: CITY,
        desk: 'sos',
        personId: 'p_noor',
        rank: 1,
        startsAt: h(-1),
        endsAt: h(8),
        createdById: 'p_ali',
      },
      t,
    );
    await repo.addShift(
      {
        cityId: CITY,
        desk: 'sos',
        personId: 'p_later',
        rank: 1,
        startsAt: h(2),
        endsAt: h(4),
        createdById: 'p_ali',
      },
      t,
    );
    await repo.addShift(
      {
        cityId: CITY,
        desk: 'cash',
        personId: 'p_sara',
        rank: 1,
        startsAt: h(-1),
        endsAt: h(8),
        createdById: 'p_ali',
      },
      t,
    );
    expect((await repo.onCallAt(CITY, 'sos', t)).map((s) => s.personId)).toEqual([
      'p_noor',
      'p_omar',
    ]);
    expect((await repo.shifts(CITY, t, h(24))).map((s) => s.personId).sort()).toEqual([
      'p_later',
      'p_noor',
      'p_omar',
      'p_sara',
    ]);
    const ended = await repo.endShift(one.id, t);
    expect(ended.endedAt).toEqual(t);
    expect((await repo.endShift(one.id, h(1))).endedAt).toEqual(t); // the first end stands
    expect((await repo.onCallAt(CITY, 'sos', t)).map((s) => s.id)).toEqual([two.id]);
  });

  it('opens a ladder once, advances it only as read (one machine wins), and stops when taken', async () => {
    const id = `sos_it_${Date.now()}`;
    alerts.push(id);
    const t = new Date('2026-10-09T21:00:00Z');
    const brief = { raiserId: 'p_rider', role: 'customer', subjectKind: 'order', orderId: 'ord_x', subjectLabel: 'طلب أكل #123' };
    expect(
      await repo.openLadder({
        alertId: id,
        kind: 'sos',
        cityId: CITY,
        brief,
        openedAt: t,
        nextRingAt: new Date(t.getTime() + 30_000),
      }),
    ).toMatchObject({ alertId: id, brief, rings: 0, steps: [] });
    expect(
      await repo.openLadder({
        alertId: id,
        kind: 'sos',
        cityId: CITY,
        brief,
        openedAt: t,
        nextRingAt: t,
      }),
    ).toBeNull();

    const step = { at: new Date(t.getTime() + 30_000), step: 'ring' as const, count: 3 };
    const patch = {
      rings: 1,
      onCallStep: 0,
      nextRingAt: new Date(t.getTime() + 60_000),
      unanswered: false,
      step,
    };
    const [a, b] = await Promise.all([
      repo.advance(id, { rings: 0, onCallStep: 0 }, patch),
      repo.advance(id, { rings: 0, onCallStep: 0 }, patch),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(
      await repo.advance(
        id,
        { rings: 1, onCallStep: 0 },
        {
          rings: 1,
          onCallStep: 1,
          nextRingAt: patch.nextRingAt,
          unanswered: true,
          step: { at: new Date(t.getTime() + 60_000), step: 'admins', count: 1 },
        },
      ),
    ).toBe(true);
    const l = (await repo.ladder(id))!;
    expect(l).toMatchObject({ rings: 1, onCallStep: 1, unanswered: true });
    expect(l.steps).toEqual([
      step,
      { at: new Date(t.getTime() + 60_000), step: 'admins', count: 1 },
    ]);
    expect((await repo.ringing(500)).some((r) => r.alertId === id)).toBe(true);

    expect(await repo.take(id, new Date(t.getTime() + 70_000))).toBe(true);
    expect(await repo.take(id, new Date(t.getTime() + 80_000))).toBe(false);
    expect(await repo.ladder(id)).toMatchObject({
      unanswered: false,
      takenAt: new Date(t.getTime() + 70_000),
    });
    expect((await repo.ringing(500)).some((r) => r.alertId === id)).toBe(false);
    expect(
      await repo.advance(id, { rings: 1, onCallStep: 1 }, { ...patch, rings: 2, onCallStep: 1 }),
    ).toBe(false);
    expect(await repo.close(id, new Date(t.getTime() + 90_000))).toBe(true);
  });

  it('keeps screen heartbeats and opens one watch alert per kind at a time', async () => {
    const t = new Date('2026-10-10T03:00:00Z');
    const s = (n: number) => new Date(t.getTime() + n * 1000);
    await watch.touch({ cityId: CITY, tabId: 'tab_a_123', personId: 'p_haider', live: 'live' }, s(0));
    await watch.touch({ cityId: CITY, tabId: 'tab_a_123', personId: 'p_haider', live: 'live' }, s(30));
    await watch.touch({ cityId: CITY, tabId: 'tab_b_123', personId: 'p_sara', live: 'fallback' }, s(30));
    await watch.touch({ cityId: CITY, tabId: 'tab_b_123', personId: 'p_sara', live: 'fallback' }, s(60));
    await watch.touch({ cityId: CITY, tabId: 'tab_a_123', personId: 'p_haider', live: 'fallback' }, s(60));
    const tabs = await watch.presentSince(CITY, s(0));
    expect(
      tabs
        .map((x) => [x.tabId, x.live, x.liveSince.getTime() - t.getTime(), x.lastSeenAt.getTime() - t.getTime()])
        .sort(),
    ).toEqual([
      ['tab_a_123', 'fallback', 60_000, 60_000],
      ['tab_b_123', 'fallback', 30_000, 60_000],
    ]);
    expect(await watch.lastSeen(CITY)).toEqual(s(60));

    const a = await watch.open(CITY, 'live_down', s(120));
    expect(a).toMatchObject({ kind: 'live_down', paged: 0, closedAt: null });
    expect(await watch.open(CITY, 'live_down', s(125))).toBeNull();
    await watch.setPaged(a!.id, 2);
    expect((await watch.openFor(CITY)).map((x) => [x.kind, x.paged])).toEqual([['live_down', 2]]);
    expect(await watch.close(CITY, 'live_down', s(150))).toBe(true);
    expect(await watch.close(CITY, 'live_down', s(155))).toBe(false);
    expect(await watch.openFor(CITY)).toEqual([]);
    expect(await watch.open(CITY, 'live_down', s(200))).not.toBeNull();

    expect(await watch.dropBefore(s(61))).toBeGreaterThanOrEqual(2);
    expect(await watch.lastSeen(CITY)).toBeNull();
  });

  it('keeps the shift handover note and who read it (a second tap is a no-op)', async () => {
    const t = new Date('2026-10-09T05:00:00Z');
    const old = await handovers.add({ cityId: CITY, authorId: 'p_noor', body: 'قديمة' }, t);
    const note = await handovers.add({ cityId: CITY, authorId: 'p_omar', body: 'الطابعة عاطلة' }, new Date(t.getTime() + 60_000));
    expect((await handovers.latest(CITY, t))?.id).toBe(note.id);
    expect(await handovers.latest(CITY, new Date(t.getTime() + 120_000))).toBeNull();
    await handovers.ack(note.id, 'p_ali', t);
    await handovers.ack(note.id, 'p_ali', t);
    await handovers.ack(note.id, 'p_omar', t);
    expect((await handovers.find(note.id))?.ackedBy.sort()).toEqual(['p_ali', 'p_omar']);
    expect((await handovers.find(old.id))?.ackedBy).toEqual([]);
    expect(await handovers.find('hnd_missing')).toBeNull();
  });
});
