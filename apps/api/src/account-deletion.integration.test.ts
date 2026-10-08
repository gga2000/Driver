import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { AppModule } from './app.module.js';
import { IdentityService } from './modules/identity/index.js';
import { OrdersService } from './modules/orders/index.js';
import { SavedPlacesService } from './modules/places/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { PrismaService } from './shared/db/prisma.service.js';

/**
 * W7 account deletion on a real Postgres through the app's own wiring: a customer with a saved home,
 * a delivered food order with notes and a pushed phone deletes his account; the vault rows, sessions,
 * saved places and push tokens are gone, the order stays with its notes cleared and its pins blurred
 * to the 0.01° grid, his events lose their locations, and `people.erased_at` is set. The number is
 * kept only as a hash. Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];
const HOME = { lat: 32.91234, lng: 45.06378 };
const DAY = '2026-10-03T10:00:00Z'; // Saturday 13:00 in Baghdad: kitchens open

describe.skipIf(!url)('account deletion on Postgres (needs DATABASE_URL)', () => {
  const clock = new FakeClock(DAY);
  const phone = `0773${String(Date.now() % 10_000_000).padStart(7, '0')}`;
  let app: INestApplication;
  let db: PrismaService['prisma'];
  let personId = '';
  let orderId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    db = app.get(PrismaService).prisma;
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    for (let i = 0; i < 50 && (await db.outbox.count({ where: { status: 'pending', attempts: 0 } })) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    await app.close();
  });

  it('a customer with a home, an order and a phone deletes his account; what is kept is blurred', async () => {
    const identity = app.get(IdentityService);
    await identity.requestOtp({ phone, purpose: 'login' });
    const login = await identity.verifyOtp({ phone, code: (await identity.devLastOtp(phone)).code!, device: { fingerprint: `del-it-${phone}`, platform: 'android' } });
    personId = login.personId;
    await identity.updateProfile({ personId, sessionId: 'it' }, { name: 'حسين علي' });
    await app.get(SavedPlacesService).save(personId, { cityId: 'aziziyah', label: 'home', name: 'البيت', pin: HOME, note: 'الباب الأخضر', photoIds: [], shareWithHousehold: false });

    const khalid = AZIZIYAH_RESTAURANTS.find((r) => r.key === 'khalid')!;
    const order = await app.get(OrdersService).place(personId, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid.orgId,
      lines: [{ catalogItemId: `${khalid.orgId}_pepsi`, qty: 1, note: 'بارد رجاءً' }],
      dropoff: { zoneKey: 'street_30', pin: HOME },
      note: 'اتصل من توصل',
      courierNote: 'البيت اللي بيه شجرة',
    });
    orderId = order.id;
    // An open order waits: deletion is refused until it is delivered.
    expect((await identity.deletionCheck({ personId, sessionId: 'it' })).blockers).toEqual([{ kind: 'open_order', count: 1 }]);
    await db.order.update({ where: { id: orderId }, data: { state: 'delivered' } });
    expect((await identity.deletionCheck({ personId, sessionId: 'it' })).blockers).toEqual([]);

    await identity.deletionStart({ personId, sessionId: 'it' });
    await identity.deletionConfirm({ personId, sessionId: 'it' }, { code: (await identity.devLastOtp(phone)).code! });

    const person = await db.person.findUniqueOrThrow({ where: { id: personId } });
    expect(person.deletedAt).not.toBeNull();
    expect(person.erasedAt).not.toBeNull();
    expect(await db.personIdentity.count({ where: { personId } })).toBe(0);
    expect(await db.session.count({ where: { personId } })).toBe(0);
    expect(await db.device.count({ where: { personId } })).toBe(0);
    expect(await db.pushToken.count({ where: { personId } })).toBe(0);
    expect(await db.place.count({ where: { ownerId: personId } })).toBe(0);
    expect(await db.role.count({ where: { personId, revokedAt: null } })).toBe(0);
    expect(await db.retiredPhone.count({ where: { retiredAt: person.deletedAt! } })).toBeGreaterThan(0);

    const kept = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    expect(kept).toMatchObject({ note: null, courierNote: null, totalIqd: order.totalIqd });
    expect(kept.dropoff).toEqual({ zoneKey: 'street_30', pin: { lat: 32.91, lng: 45.06 } });
    expect(kept.lines.every((l) => l.note === null)).toBe(true);

    const pins = await db.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(target_pin::geometry) AS lat, ST_X(target_pin::geometry) AS lng FROM "public"."stops" WHERE order_id = ${orderId} AND target_pin IS NOT NULL`;
    for (const p of pins) {
      expect(Math.abs(p.lat * 100 - Math.round(p.lat * 100))).toBeLessThan(1e-6);
      expect(Math.abs(p.lng * 100 - Math.round(p.lng * 100))).toBeLessThan(1e-6);
    }
    const located = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "public"."events" WHERE actor_id = ${personId} AND location IS NOT NULL`;
    expect(Number(located[0]!.n)).toBe(0);

    // The job finds nothing left to do; the same number signs up as a new person.
    expect(await identity.deletion.resume()).toBe(0);
    await identity.requestOtp({ phone, purpose: 'login' });
    const again = await identity.verifyOtp({ phone, code: (await identity.devLastOtp(phone)).code!, device: { fingerprint: `del-it-${phone}`, platform: 'android' } });
    expect(again.personId).not.toBe(personId);
    expect(await identity.numberHadEarlierAccount(again.personId)).toBe(true);
  }, 90_000);
});
