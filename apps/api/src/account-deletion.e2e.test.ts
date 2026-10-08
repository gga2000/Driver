import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { transformer, type AppRouter, type RoleKind } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { ACCOUNT_DELETION_ENABLED, ErasureNotReady, ErasureRegistry, IDENTITY_ERASED_TABLES, IdentityService } from './modules/identity/index.js';
import { IDENTITY_REPOSITORY, type IdentityRepository } from './modules/identity/identity.repository.js';
import { Accounts, LedgerService } from './modules/ledger/index.js';
import { TrpcService } from './trpc/trpc.module.js';
import { CLOCK, FakeClock } from './shared/clock.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** `schema.table` of every Prisma model (its `@@map` and `@@schema`). */
function prismaTables(): string[] {
  const schema = readFileSync(resolve(root, 'packages/db/prisma/schema.prisma'), 'utf8');
  return [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => {
    const table = /@@map\("([^"]+)"\)/.exec(body!)?.[1] ?? name!;
    const schemaName = /@@schema\("([^"]+)"\)/.exec(body!)?.[1] ?? 'public';
    return `${schemaName}.${table}`;
  });
}

type Class = 'erase' | 'blur' | 'keep' | 'none';

/** The rows of docs/launch/data-inventory.md (between its markers). */
function inventory(): Array<{ table: string; cls: Class; owner: string }> {
  const doc = readFileSync(resolve(root, 'docs/launch/data-inventory.md'), 'utf8');
  const body = doc.slice(doc.indexOf('<!-- inventory:start -->'), doc.indexOf('<!-- inventory:end -->'));
  return [...body.matchAll(/^\| `([\w.]+)` \| (\w+) \| ([\w-]+) \|/gm)].map(([, table, cls, owner]) => ({ table: table!, cls: cls as Class, owner: owner! }));
}

async function boot(clock: FakeClock, deletionOn = true) {
  let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock);
  if (!deletionOn) builder = builder.overrideProvider(ACCOUNT_DELETION_ENABLED).useValue(false);
  const app = (await builder.compile()).createNestApplication<NestExpressApplication>({ logger: ['error'] });
  app.get(TrpcService).mount(app);
  await app.listen(0);
  const address = app.getHttpServer().address();
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const anon = () => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer })] });
  const as = (token: string) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer, headers: { authorization: `Bearer ${token}` } })] });
  async function signIn(phone: string, roles: RoleKind[] = []) {
    const c = anon();
    await c.identity.requestOtp.mutate({ phone });
    const { code } = await c.identity.devLastOtp.query({ phone });
    const res = await c.identity.verifyOtp.mutate({ phone, code: code!, device: { fingerprint: `e2e-${phone}`, platform: 'web' } });
    for (const kind of roles) await app.get(IdentityService).grantRole({ personId: 'system:e2e', sessionId: 'e2e' }, { personId: res.personId, kind });
    return { client: as(res.tokens.accessToken), personId: res.personId };
  }
  return { app, anon, signIn };
}

const errCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof TRPCClientError ? (err.data as { code?: string } | undefined)?.code : String(err);
  }
};

/**
 * W7 account deletion (REL-01, docs/api/account-deletion.md) over the wire, on the app's own wiring:
 * the inventory covers every table and matches the registered steps; a customer deletes his account
 * with a code sent to his own number; what stands in the way is listed; the switch turns it off.
 */
describe('account deletion (e2e)', () => {
  const clock = new FakeClock('2026-10-08T09:00:00Z');
  let ctx: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    ctx = await boot(clock);
  });

  afterAll(async () => {
    await ctx?.app.close();
    vi.useRealTimers();
  });

  it('the data inventory classifies every table once, and its erase/blur tables are exactly the steps’ tables', () => {
    const rows = inventory();
    const tables = prismaTables();
    const listed = rows.map((r) => r.table);
    expect(listed.filter((t, i) => listed.indexOf(t) !== i), 'listed twice').toEqual([]);
    expect(tables.filter((t) => !listed.includes(t)), 'tables missing from docs/launch/data-inventory.md').toEqual([]);
    expect(listed.filter((t) => !tables.includes(t)), 'inventory rows for tables that no longer exist').toEqual([]);
    for (const r of rows) expect(['erase', 'blur', 'keep', 'none'], r.table).toContain(r.cls);

    const steps = ctx.app.get(ErasureRegistry).steps();
    const named = [...IDENTITY_ERASED_TABLES, ...steps.flatMap((s) => s.tables)];
    expect(named.filter((t, i) => named.indexOf(t) !== i), 'a table named by two steps').toEqual([]);
    const touched = rows.filter((r) => r.cls === 'erase' || r.cls === 'blur').map((r) => r.table);
    expect([...named].sort()).toEqual([...touched].sort());
    // Each touched table's owner in the inventory is the step that names it.
    for (const s of steps) for (const t of s.tables) expect(rows.find((r) => r.table === t)?.owner, t).toBe(s.owner);
  });

  it('a customer deletes his account with a code to his own number; everything about him goes and he is signed out', async () => {
    const phone = '07701234001';
    const me = await ctx.signIn(phone);
    await me.client.places.save.mutate({ label: 'home', name: 'بيت أهلي', pin: { lat: 32.9101, lng: 45.0631 }, note: 'الباب الأخضر' });
    await me.client.notify.registerDevice.mutate({ token: 'ExponentPushToken[deletion-e2e]', app: 'customer', platform: 'android' });
    const code = (await me.client.referral.mine.query()).code;
    expect((await me.client.places.mine.query()).length).toBe(1);

    expect(await me.client.identity.deleteAccount.check.query()).toEqual({ available: true, blockers: [], points: 0 });
    // A code that was never sent is refused; the account stays.
    expect(await errCode(me.client.identity.deleteAccount.confirm.mutate({ code: '000000' }))).not.toBe('ok');
    // The code can only be asked for through deleteAccount.start (never with requestOtp).
    expect(await errCode(ctx.anon().identity.requestOtp.mutate({ phone, purpose: 'account_delete' as never }))).not.toBe('ok');

    const started = await me.client.identity.deleteAccount.start.mutate();
    expect(started.phoneMasked).toMatch(/\*01$/);
    const sent = (await ctx.anon().identity.devLastOtp.query({ phone })).code!;
    expect(await errCode(me.client.identity.deleteAccount.confirm.mutate({ code: sent === '111111' ? '222222' : '111111' }))).not.toBe('ok');
    const done = await me.client.identity.deleteAccount.confirm.mutate({ code: sent });
    expect(done.deletedAt).toEqual(clock.now());

    // Signed out on every phone; the account is closed and every step has finished.
    expect(await errCode(me.client.identity.me.query())).not.toBe('ok');
    const repo = ctx.app.get<IdentityRepository>(IDENTITY_REPOSITORY);
    const person = await repo.findPersonById(me.personId);
    expect(person?.deletedAt).toEqual(clock.now());
    expect(person?.erasedAt).toEqual(clock.now());
    expect(await repo.readIdentity(me.personId)).toBeNull();

    // The same number signs up again: a new, empty account that is not "new" for invite rewards.
    const again = await ctx.signIn(phone);
    expect(again.personId).not.toBe(me.personId);
    expect(await again.client.places.mine.query()).toEqual([]);
    const friend = await ctx.signIn('07701234002');
    const theirCode = (await friend.client.referral.mine.query()).code;
    expect(await errCode(again.client.referral.claim.mutate({ code: theirCode }))).toBe('invite_not_new');
    // His old invite code no longer works.
    expect(await errCode(friend.client.referral.claim.mutate({ code }))).toBe('invite_invalid');
  });

  it('money in the wallet and a work role stand in the way, and are listed first', async () => {
    const owed = await ctx.signIn('07701234003');
    await ctx.app.get(LedgerService).recordAll({
      id: `deletion-e2e:${owed.personId}`,
      kind: 'money',
      occurredAt: clock.now(),
      refs: {},
      lines: [{ type: 'credit_issued', amount: 5_000, fromAccount: Accounts.bank, toAccount: Accounts.customer(owed.personId), memo: 'topup:agent' }],
      controls: [],
    });
    expect((await owed.client.identity.deleteAccount.check.query()).blockers).toEqual([{ kind: 'wallet_balance', amountIqd: 5_000 }]);
    expect(await errCode(owed.client.identity.deleteAccount.start.mutate())).toBe('account_delete_blocked');

    const courier = await ctx.signIn('07701234004', ['courier']);
    expect((await courier.client.identity.deleteAccount.check.query()).blockers).toEqual([{ kind: 'work_role' }]);
    expect(await errCode(courier.client.identity.deleteAccount.start.mutate())).toBe('account_delete_blocked');
  });

  it('a step that cannot finish yet is retried by the job until every step has run', async () => {
    let ready = false;
    ctx.app.get(ErasureRegistry).register({
      owner: 'e2e-gate',
      tables: [],
      erase: async () => {
        if (!ready) throw new ErasureNotReady('waiting for the test');
      },
    });
    const phone = '07701234005';
    const me = await ctx.signIn(phone);
    await me.client.identity.deleteAccount.start.mutate();
    await me.client.identity.deleteAccount.confirm.mutate({ code: (await ctx.anon().identity.devLastOtp.query({ phone })).code! });
    const repo = ctx.app.get<IdentityRepository>(IDENTITY_REPOSITORY);
    expect((await repo.findPersonById(me.personId))?.erasedAt ?? null).toBeNull();
    const identity = ctx.app.get(IdentityService);
    expect(await identity.deletion.resume()).toBe(0);
    ready = true;
    expect(await identity.deletion.resume()).toBe(1);
    expect((await repo.findPersonById(me.personId))?.erasedAt).toEqual(clock.now());
    expect(await identity.deletion.resume()).toBe(0);
  });
});

describe('account deletion switched off (e2e)', () => {
  const clock = new FakeClock('2026-10-08T09:00:00Z');
  let ctx: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    ctx = await boot(clock, false);
  });

  afterAll(async () => {
    await ctx?.app.close();
    vi.useRealTimers();
  });

  it('the screen sends people to support and nothing can be deleted', async () => {
    const me = await ctx.signIn('07701234006');
    expect((await me.client.identity.deleteAccount.check.query()).available).toBe(false);
    expect(await errCode(me.client.identity.deleteAccount.start.mutate())).toBe('account_deletion_off');
    expect(await errCode(me.client.identity.deleteAccount.confirm.mutate({ code: '123456' }))).toBe('account_deletion_off');
  });
});
