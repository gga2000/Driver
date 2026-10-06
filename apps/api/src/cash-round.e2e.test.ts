import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FinanceDeskView } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { cashRoundFromHourEnv, ControlRoomService, roundWindowStart } from './modules/control-room/index.js';
import { DispatchService } from './modules/dispatch/index.js';
import { DriverAccountService } from './modules/driver-account/index.js';
import { IdentityService } from './modules/identity/index.js';
import { LedgerService } from './modules/ledger/index.js';
import { OpsService } from './modules/ops/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';

const SYSTEM = { personId: 'system:e2e', sessionId: 'e2e' };
const ZAKUR = { lat: 32.887, lng: 45.0765 };

/**
 * K1a (S-K5): the 23:00 cash round on an evening clock (22:30 Baghdad), through the app's own wiring.
 * «استلمت» on the Console is `ops.recordCashReceipt`; the desk's round line ("جمعنا X من Y") and the
 * progress bar are `round.collectedIqd / targetIqd`, and a courier taken to zero stays on his stop
 * with what was collected instead of vanishing.
 */
describe('the 23:00 cash round on an evening clock', () => {
  const clock = new FakeClock('2026-10-06T19:30:00Z'); // 22:30 Baghdad
  let app: INestApplication;
  let staff: { personId: string; sessionId: string };

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    staff = { personId: await person('07700099001', 'علي', ['admin', 'field_ops', 'finance']), sessionId: 'e2e' };
  });

  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });

  async function person(phone: string, name: string, roles: Array<'courier' | 'admin' | 'field_ops' | 'finance'>): Promise<string> {
    const identity = app.get(IdentityService);
    const id = await identity.ensurePersonByPhone(phone, 'system:e2e', 'e2e');
    await identity.updateProfile({ personId: id, sessionId: 'e2e' }, { name });
    for (const kind of roles) await identity.grantRole(SYSTEM, { personId: id, kind });
    return id;
  }

  const onlineIds: string[] = [];
  const online = (id: string) => app.get(DispatchService).presence.online(id, { cityId: 'aziziyah', at: ZAKUR, zoneId: 'zakur', vehicle: 'bike', tier: 'bronze', verticals: ['food'] });

  /** A courier online in Zakur holding `heldIqd` of customers' cash from this evening. */
  async function courier(phone: string, name: string, heldIqd: number): Promise<string> {
    const id = await person(phone, name, ['courier']);
    await app.get(LedgerService).record({ type: 'cash_collected', amount: heldIqd, fromAccount: `cash:${id}`, toAccount: 'customer:c_e2e', occurredAt: new Date(clock.now().getTime() - 40 * 60_000), idempotencyKey: `e2e:cash:${id}` });
    await online(id);
    onlineIds.push(id);
    return id;
  }

  /** Minutes pass on the round; the couriers' apps keep their presence fresh meanwhile. */
  async function later(minutes: number): Promise<void> {
    clock.advanceMinutes(minutes);
    for (const id of onlineIds) await online(id);
  }

  const desk = (): Promise<FinanceDeskView> => app.get(ControlRoomService).finance(staff, { cityId: 'aziziyah' });
  const onRound = (d: FinanceDeskView, id: string) => d.round.stops.flatMap((s) => s.couriers).find((c) => c.driverId === id);

  async function collect(courierId: string, amountIqd: number) {
    const { code } = await app.get(DriverAccountService).handoverCode({ personId: courierId, sessionId: 'e2e' });
    return app.get(OpsService).recordCashReceipt(staff, { courierId, amountIqd, code, idempotencyKey: `e2e-round-${courierId}-${amountIqd}` });
  }

  it('«استلمت» moves the line and the bar, and the courier stays on his stop as collected', async () => {
    const saif = await courier('07720099011', 'سيف', 40_000);
    const ahmed = await courier('07720099012', 'أحمد', 30_000);

    const before = await desk();
    expect(before.round.from?.toISOString()).toBe('2026-10-06T15:00:00.000Z'); // 18:00 Baghdad
    const baseCollected = before.round.collectedIqd ?? 0;
    const baseTarget = before.round.targetIqd ?? 0;
    expect(onRound(before, saif)).toMatchObject({ heldIqd: 40_000, collected: null });

    // Saif hands over everything: the line gains 40,000, the target stays (collected + still held).
    await later(5);
    const r1 = await collect(saif, 40_000);
    const after1 = await desk();
    expect(after1.round.collectedIqd).toBe(baseCollected + 40_000);
    expect(after1.round.targetIqd).toBe(baseTarget);
    expect(after1.round.totalIqd).toBe(before.round.totalIqd - 40_000);
    // He holds nothing now and is no cash holder any more, yet he is still on the Zakur stop: collected.
    expect(after1.couriers.find((c) => c.driverId === saif)).toBeUndefined();
    const zakur = after1.round.stops.find((s) => s.zoneKey === 'zakur')!;
    expect(zakur.couriers.find((c) => c.driverId === saif)).toMatchObject({ heldIqd: 0, collected: { amountIqd: 40_000, reference: r1.reference } });
    expect(zakur.collectedIqd).toBe(40_000);

    // Ahmed hands over part of it: collected, still holding the rest.
    await later(5);
    await collect(ahmed, 10_000);
    const after2 = await desk();
    expect(after2.round.collectedIqd).toBe(baseCollected + 50_000);
    expect(onRound(after2, ahmed)).toMatchObject({ heldIqd: 20_000, collected: { amountIqd: 10_000 } });

    // Past midnight it is still last night's round: nothing drops off.
    clock.set(new Date('2026-10-06T22:10:00Z')); // 01:10 Baghdad
    await later(0);
    const late = await desk();
    expect(late.round.collectedIqd).toBe(baseCollected + 50_000);
    expect(onRound(late, saif)).toMatchObject({ heldIqd: 0, collected: { amountIqd: 40_000 } });
  });

  it('the round window start comes from CASH_ROUND_FROM_HOUR (0–23), else 18:00', () => {
    expect(cashRoundFromHourEnv(undefined)).toBe(18);
    expect(cashRoundFromHourEnv('')).toBe(18);
    expect(cashRoundFromHourEnv('0')).toBe(0);
    expect(cashRoundFromHourEnv('24')).toBe(18);
    expect(cashRoundFromHourEnv('7.5')).toBe(18);
    // The demo's 0: at 14:00 Baghdad receipts from midnight count.
    expect(roundWindowStart(new Date('2026-10-06T11:00:00Z'), 0).toISOString()).toBe('2026-10-05T21:00:00.000Z');
  });
});
