import { afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaSafetyRepository, type IncidentRecord } from './safety.repository.js';

const url = process.env['DATABASE_URL'];
const RAISER = `p_sos_it_${Date.now()}`;

describe.skipIf(!url)('safety incidents on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaSafetyRepository(prisma);
  const ids: string[] = [];

  afterAll(async () => {
    await prisma.prisma.$executeRaw`DELETE FROM "public"."safety_incident_fixes" WHERE "incident_id" = ANY(${ids})`;
    await prisma.prisma.$executeRaw`DELETE FROM "public"."safety_incident_entries" WHERE "incident_id" = ANY(${ids})`;
    await prisma.prisma.$executeRaw`DELETE FROM "public"."safety_incidents" WHERE "raiser_id" = ${RAISER}`;
    await prisma.onModuleDestroy();
  });

  it('writes an incident with its trail and timeline; client ids are unique per person; claims race safely', async () => {
    const at = new Date('2026-10-05T18:00:00Z');
    const base: Omit<IncidentRecord, 'id'> = {
      cityId: 'aziziyah',
      raiserId: RAISER,
      raiserRole: 'customer',
      subjectKind: 'order',
      subjectId: 'ord_x',
      tripId: 'trp_x',
      orderId: 'ord_x',
      departureId: null,
      counterpartId: 'p_driver',
      state: 'open',
      category: null,
      clientId: 'press-1',
      raiseEventId: null,
      contactSet: true,
      contactAt: null,
      subjectLabel: 'مشوار تكتك #1290',
      vehicleLabel: '12345 واسط',
      pressedAt: at,
      raisedAt: at,
      cancelUntil: new Date(at.getTime() + 10_000),
      last: { lat: 32.9, lng: 45.06, accuracyM: 10, deviceAt: at, at },
      acknowledgedAt: null,
      acknowledgedById: null,
      escalatedAt: null,
      cancelledAt: null,
      resolvedAt: null,
      resolvedById: null,
      outcome: null,
      resolution: null,
    };
    const inc = await repo.create(base);
    ids.push(inc.id);
    expect(inc).toMatchObject({ state: 'open', last: { lat: 32.9, lng: 45.06, accuracyM: 10 } });
    await expect(repo.create(base)).rejects.toBeTruthy();
    expect((await repo.byClient(RAISER, 'press-1'))?.id).toBe(inc.id);
    await repo.addFix({ incidentId: inc.id, lat: 32.91, lng: 45.07, accuracyM: null, deviceAt: at, at: new Date(at.getTime() + 5_000) });
    await repo.addEntry({ incidentId: inc.id, kind: 'raised', at, byId: null, note: null, data: { role: 'customer' } });
    expect(await repo.countFixesSince(inc.id, at)).toBe(1);
    expect((await repo.entries(inc.id))[0]).toMatchObject({ kind: 'raised', data: { role: 'customer' } });
    const [a, b] = await Promise.all([repo.claim(inc.id, 'escalatedAt', at, ['open']), repo.claim(inc.id, 'escalatedAt', at, ['open'])]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const updated = await repo.update(inc.id, { state: 'resolved', outcome: 'safe', resolution: 'بخير', last: null });
    expect(updated).toMatchObject({ state: 'resolved', outcome: 'safe', last: null });
    expect((await repo.list({ states: ['open'], limit: 500 })).some((r) => r.id === inc.id)).toBe(false);
  });
});
