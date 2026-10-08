import { afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaOnCallRepository } from './on-call.repository.js';

const url = process.env['DATABASE_URL'];
const CITY = `oncall_it_${Date.now()}`;

describe.skipIf(!url)('on call on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaOnCallRepository(prisma);
  const alerts: string[] = [];

  afterAll(async () => {
    await prisma.prisma
      .$executeRaw`DELETE FROM "public"."on_call_shifts" WHERE "city_id" = ${CITY}`;
    await prisma.prisma
      .$executeRaw`DELETE FROM "public"."alert_ladders" WHERE "alert_id" = ANY(${alerts})`;
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
    const brief = { raiserId: 'p_rider', role: 'customer', subjectKind: 'order', orderId: 'ord_x' };
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
});
