import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SAFETY_RULES, type Actor } from '@driver/contracts';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { AppModule } from './app.module.js';
import { IdentityService } from './modules/identity/index.js';
import { OrdersService } from './modules/orders/index.js';
import { SafetyService } from './modules/safety/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { PrismaService } from './shared/db/prisma.service.js';

/**
 * Server correctness on a real Postgres, through the app's own wiring (AppModule): an SOS is never
 * refused (FLOW-08). Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];
const STREET_30 = { lat: 32.9098, lng: 45.0628 };
const DAY = '2026-10-03T10:00:00Z'; // Saturday 13:00 in Baghdad: kitchens open, no prayer pause

describe.skipIf(!url)('server correctness on Postgres (needs DATABASE_URL)', () => {
  const clock = new FakeClock(DAY);
  const run = Date.now().toString(36);
  const base = Date.now();
  const phone = (n: number) => `0773${String((base + n * 7919) % 10_000_000).padStart(7, '0')}`;
  let app: INestApplication;
  let db: PrismaService['prisma'];
  const people = { customer: '' };
  const as = (personId: string): Actor => ({ personId, sessionId: `s_${run}` });
  const khalid = AZIZIYAH_RESTAURANTS.find((r) => r.key === 'khalid')!;
  const placeFood = (personId: string, clientRequestId?: string) =>
    app.get(OrdersService).place(personId, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid.orgId,
      lines: [{ catalogItemId: `${khalid.orgId}_pepsi`, qty: 2 }],
      dropoff: { zoneKey: 'street_30', pin: STREET_30 },
      ...(clientRequestId ? { clientRequestId } : {}),
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    db = app.get(PrismaService).prisma;
    const identity = app.get(IdentityService);
    people.customer = await identity.ensurePersonByPhone(phone(1), 'system:test', 'server_correctness_it', { name: 'زينب علي' });
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    // Let the outbox finish what this boot wrote before the app (and its Prisma client) closes.
    for (let i = 0; i < 50 && (await db.outbox.count({ where: { status: 'pending', attempts: 0 } })) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    await app.close();
  });

  it('FLOW-08: a sixth SOS in an hour after five cancelled false alarms still opens an incident', async () => {
    clock.set(DAY);
    const safety = app.get(SafetyService);
    const order = await placeFood(people.customer);
    const press = (n: number) => safety.sos(as(people.customer), { subject: { kind: 'order', id: order.id }, position: null, clientId: `sos-${run}-${n}` });
    for (let i = 0; i < SAFETY_RULES.maxPerHour; i++) {
      const v = await press(i);
      expect(v.state).toBe('open');
      await safety.cancel(as(people.customer), { incidentId: v.incidentId });
      clock.advanceSeconds(60);
    }
    const real = await press(99);
    expect(real.state).toBe('open');
    const rows = await db.safetyIncident.findMany({ where: { raiserId: people.customer }, orderBy: { raisedAt: 'asc' } });
    expect(rows.map((r) => r.state)).toEqual([...Array<string>(SAFETY_RULES.maxPerHour).fill('cancelled'), 'open']);
    // Cancelled presses don't count: the real alert is not flagged as a repeat.
    const raised = await db.safetyIncidentEntry.findFirstOrThrow({ where: { incidentId: real.incidentId, kind: 'raised' } });
    expect((raised.data as Record<string, string>)['repeated']).toBeUndefined();
  }, 60_000);
});
