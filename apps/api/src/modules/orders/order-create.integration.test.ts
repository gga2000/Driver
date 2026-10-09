import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { ordersHarness } from './test-harness.js';
import { PrismaOrdersRepository, type NewLine, type NewOrder, type NewParticipant } from './orders.repository.js';

/**
 * SCALE-24 on a real Postgres: an order's participants and lines are written one statement each and
 * read back in the order they were given, each line tied to its own participant, inside a transaction
 * and outside one. Needs DATABASE_URL with the migrations deployed and the seed; skipped otherwise.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('orders.create on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaOrdersRepository(prisma);
  const uow = new UnitOfWork(prisma);
  const ids = { me: '', org: '' };
  const made: string[] = [];
  let base: NewOrder;

  beforeAll(async () => {
    const db = prisma.prisma;
    ids.me = (await db.person.create({ data: {} })).id;
    ids.org = (await db.org.create({ data: { type: 'restaurant', name: 'مطعم الكتابة', cityId: 'aziziyah' } })).id;
    const h = ordersHarness();
    const placed = await h.orders.place('c1', h.foodInput());
    // A placed order's record as a new-order input (create assigns its own id and state).
    const placedRecord: Record<string, unknown> = { ...(await h.repo.find(placed.id))!.order };
    delete placedRecord['id'];
    delete placedRecord['state'];
    base = { ...(placedRecord as unknown as NewOrder), cityId: 'aziziyah', ordererId: ids.me, merchantOrgId: ids.org, householdOrgId: null, quoteId: null, promotionId: null, preferredDriverId: null, clientRequestId: null };
  });

  afterAll(async () => {
    const db = prisma.prisma;
    await db.orderLine.deleteMany({ where: { orderId: { in: made } } });
    await db.participant.deleteMany({ where: { orderId: { in: made } } });
    await db.order.deleteMany({ where: { id: { in: made } } });
    await db.org.deleteMany({ where: { id: ids.org } });
    await db.person.deleteMany({ where: { id: ids.me } });
    await prisma.onModuleDestroy();
  });

  const people: NewParticipant[] = ['a', 'b', 'c'].map((ref, i) => ({ ref, role: 'diner', personId: null, phoneHash: null, label: `ضيف ${i + 1}`, note: null }));
  const lines: NewLine[] = Array.from({ length: 7 }, (_, i) => ({
    catalogItemId: null,
    freeText: `صحن ${i + 1}`,
    qty: 1 + (i % 3),
    unitPriceIqd: 1_000 * (i + 1),
    modifiers: [],
    participantRef: i % 4 === 3 ? null : ['a', 'b', 'c'][i % 3]!,
    note: null,
    pointsEligible: true,
  }));

  it('keeps the given order of lines and participants and ties each line to its participant', async () => {
    for (const inTx of [false, true]) {
      const agg = inTx ? await uow.run((tx) => repo.create(base, lines, people, tx)) : await repo.create(base, lines, people);
      made.push(agg.order.id);
      const again = (await repo.find(agg.order.id))!;
      expect(again.participants.map((p) => p.label)).toEqual(people.map((p) => p.label));
      expect(again.lines.map((l) => l.freeText)).toEqual(lines.map((l) => l.freeText));
      const labelOf = new Map(again.participants.map((p) => [p.id, p.label]));
      expect(again.lines.map((l) => (l.participantId ? labelOf.get(l.participantId) : null))).toEqual(lines.map((l) => (l.participantRef ? people.find((p) => p.ref === l.participantRef)!.label : null)));
      expect(agg).toEqual(again);
    }
  });

  it('an order with no participants and no lines (a ride) writes neither', async () => {
    const agg = await repo.create({ ...base, type: 'ride', merchantOrgId: null }, [], []);
    made.push(agg.order.id);
    expect(agg.lines).toEqual([]);
    expect(agg.participants).toEqual([]);
  });
});
