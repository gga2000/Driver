// Demo API for driving the customer app on web (screenshots, manual QA). Runs the BUILT API
// (apps/api/dist — run `pnpm build` first) fully in memory: no Postgres/Redis, dev OTPs readable
// through identity.devLastOtp.
//
//   PORT=3200 node apps/customer/scripts/demo-api.mjs
//
// Seeds one restaurant ("مطعم خالد", centre) with a small menu, and exposes a dev-only hook
//   POST /demo/active-order?personId=<id>
// that places a cash food order for that person and has the kitchen accept it, so home shows the
// pinned active-order pill with real API data.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const apiDir = fileURLToPath(new URL('../../api/', import.meta.url));
const requireFromApi = createRequire(join(apiDir, 'package.json'));
requireFromApi('reflect-metadata');
const load = (p) => import(pathToFileURL(join(apiDir, 'dist', p)).href);

const { createApp } = await load('bootstrap.js');
const { OrdersService } = await load('modules/orders/index.js');
const { OrgsService } = await load('modules/orgs/index.js');
const { CatalogService } = await load('modules/catalog/index.js');

const PORT = Number(process.env.PORT ?? 3200);
const app = await createApp();

const orgs = app.get(OrgsService);
const catalog = app.get(CatalogService);
const orders = app.get(OrdersService);

const kitchen = { lat: 32.9095, lng: 45.0635 };
const rest = orgs.create({ type: 'restaurant', name: 'مطعم خالد', cityId: 'aziziyah', ownerId: 'demo-owner' });
orgs.setMerchantSettings(rest.id, { commissionTier: 'standard', location: { zoneKey: 'street_30', pin: kitchen } });
await orgs.settled?.();
const kas = await catalog.addItem({ orgId: rest.id, nameAr: 'لفة كص', priceIqd: 4000 });
const tikka = await catalog.addItem({ orgId: rest.id, nameAr: 'تكة لحم', priceIqd: 6000 });

app.use('/demo/active-order', async (req, res) => {
  try {
    const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
    if (req.method !== 'POST' || !personId) {
      res.statusCode = 400;
      res.end('POST /demo/active-order?personId=…');
      return;
    }
    const placed = await orders.place(personId, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: rest.id,
      lines: [
        { catalogItemId: kas.id, qty: 2 },
        { catalogItemId: tikka.id, qty: 1 },
      ],
      paymentMethod: 'cash',
      dropoff: { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } },
    });
    const accepted = await orders.merchantAccept('demo-staff', { orderId: placed.id, prepMinutes: 20 });
    const preparing = await orders.markPreparing('demo-staff', { orderId: accepted.id });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ orderId: preparing.id, state: preparing.state, totalIqd: preparing.totalIqd }));
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err?.stack ?? err));
  }
});

// ───────────────────────── account demo (places, points, household) ─────────────────────────
//   POST /demo/account?personId=<id>
// Seeds the M3 account screens for that person: a gate photo on (and confirmation of) their home,
// a work place, a cash food order with change kept as credit, an agent top-up, 2,500 points (+ 40
// pending under their number), and a household where Minar (25,000 limit) waits for approval of a
// 32,000 order and shares her family home.
{
  const { deflateSync } = await import('node:zlib');
  const { Buffer } = await import('node:buffer');
  const { IdentityService } = await load('modules/identity/index.js');
  const { SavedPlacesService, BLOB_STORE } = await load('modules/places/index.js');
  const { LedgerService, Accounts } = await load('modules/ledger/index.js');
  const identity = app.get(IdentityService);
  const places = app.get(SavedPlacesService);
  const blobs = app.get(BLOB_STORE);
  const ledger = app.get(LedgerService);

  /** A 192×192 PNG of a green door in a cream wall: the demo gate photo. */
  const doorPng = () => {
    const W = 192;
    const H = 192;
    const px = (x, y) => {
      if (x >= 62 && x < 130 && y >= 40 && y < 176) {
        if (x >= 66 && x < 126 && y >= 44) return x === 96 || (y > 104 && y < 108) ? [22, 84, 54] : x > 112 && x < 118 && y > 108 && y < 116 ? [214, 170, 60] : [34, 120, 76];
        return [120, 92, 62];
      }
      if (y >= 176) return [176, 160, 136];
      const brick = (Math.floor(y / 12) % 2 === 0 ? x : x + 16) % 32 < 1 || y % 12 < 1;
      return brick ? [214, 196, 168] : [236, 222, 196];
    };
    const raw = Buffer.alloc((W * 3 + 1) * H);
    for (let y = 0; y < H; y++) {
      raw[y * (W * 3 + 1)] = 0;
      for (let x = 0; x < W; x++) raw.set(px(x, y), y * (W * 3 + 1) + 1 + x * 3);
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (buf) => {
      let c = 0xffffffff;
      for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
      const c = Buffer.alloc(4);
      c.writeUInt32BE(crc(td));
      return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0);
    ihdr.writeUInt32BE(H, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  };

  const photoFor = async (ownerId) => {
    const bytes = doorPng();
    const ticket = await blobs.createUpload({ ownerId, contentType: 'image/png', sizeBytes: bytes.length });
    const u = new URL(ticket.uploadUrl, 'http://x');
    await blobs.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType: 'image/png', bytes });
    return ticket.uploadId;
  };

  const group = (id, kind, at, lines) => ({ id, kind, occurredAt: at, refs: {}, lines, controls: [] });

  app.use('/demo/account', async (req, res) => {
    try {
      const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
      if (req.method !== 'POST' || !personId) {
        res.statusCode = 400;
        res.end('POST /demo/account?personId=…');
        return;
      }
      const now = Date.now();
      const ago = (h) => new Date(now - h * 3_600_000);

      // Places: photo + confirmation on the home from setup (or a new one), a work place.
      const mine = await places.mine(personId);
      let home = mine.find((p) => p.label === 'home' && p.access === 'owner');
      home ??= await places.save(personId, { cityId: 'aziziyah', label: 'home', name: 'البيت', pin: { lat: 32.9097, lng: 45.0633 }, photoIds: [], shareWithHousehold: false });
      await places.update(personId, { placeId: home.id, note: 'باب أخضر، يم جامع الرسول', photoIds: [await photoFor(personId)], shareWithHousehold: true });
      await places.confirm(personId, { placeId: home.id, pin: { lat: 32.9097, lng: 45.0633 }, accuracyM: 8 });
      if (!mine.some((p) => p.label === 'work')) {
        await places.save(personId, { cityId: 'aziziyah', label: 'work', name: 'مستشفى العزيزية', pin: { lat: 32.8962, lng: 45.0671 }, note: 'الباب الخلفي، قسم المختبر', photoIds: [], shareWithHousehold: false });
      }

      // Wallet: a top-up, a cash food order with 500 change kept, points earned, pending points.
      const hash = await identity.phoneHashOf(personId);
      const customer = Accounts.customer(personId);
      await ledger.recordAll([
        group(`demo:topup:${personId}`, 'money', ago(50), [{ type: 'credit_issued', amount: 25_000, fromAccount: Accounts.bank, toAccount: customer, memo: 'topup:agent' }]),
        group(`demo:order:${personId}`, 'money', ago(3), [
          { type: 'merchant_payable', amount: 14_000, fromAccount: customer, toAccount: Accounts.merchantCash(rest.id), memo: 'items' },
          { type: 'service_fee', amount: 500, fromAccount: customer, toAccount: Accounts.platform },
          { type: 'delivery_fee', amount: 1_000, fromAccount: customer, toAccount: Accounts.driver('demo-courier') },
          { type: 'cash_collected', amount: 15_500, fromAccount: Accounts.cash('demo-courier'), toAccount: customer },
          { type: 'cash_rounding_credit', amount: 500, fromAccount: Accounts.cash('demo-courier'), toAccount: customer, memo: 'change_as_credit' },
        ]),
        group(`demo:points:${personId}`, 'points', ago(26), [{ type: 'points_earned', amount: 2_485, fromAccount: Accounts.pointsPool, toAccount: Accounts.points(personId) }]),
        group(`demo:points2:${personId}`, 'points', ago(3), [{ type: 'points_earned', amount: 15, fromAccount: Accounts.pointsPool, toAccount: Accounts.points(personId) }]),
        ...(hash ? [group(`demo:pending:${personId}`, 'points', ago(72), [{ type: 'points_pending', amount: 40, fromAccount: Accounts.pointsPool, toAccount: Accounts.pointsPending(hash) }])] : []),
      ]);

      // Household: payer = this person; Minar orders with a 25,000 limit and asks for 32,000.
      let household = orgs.householdsOf(personId)[0];
      household ??= orgs.createHousehold({ name: 'بيت علي', cityId: 'aziziyah', payerId: personId });
      const minar = await identity.ensurePersonByPhone('07801234567', personId, 'demo');
      await identity.updateProfile({ personId: minar, sessionId: 'demo' }, { name: 'منار' });
      orgs.addMember(household.id, minar, { role: 'orderer', spendingLimitIqd: 25_000, actorId: personId });
      const kid = await identity.ensurePersonByPhone('07709876543', personId, 'demo');
      await identity.updateProfile({ personId: kid, sessionId: 'demo' }, { name: 'حسين' });
      orgs.addMember(household.id, kid, { role: 'orderer', spendingLimitIqd: 10_000, actorId: personId });
      orgs.requestPayerApproval({ orgId: household.id, orderId: `demo-order-${now}`, requestedBy: minar, amountIqd: 32_000 });
      if (!(await places.mine(minar)).some((p) => p.access === 'owner')) {
        await places.save(minar, { cityId: 'aziziyah', label: 'custom', name: 'بيت أهل منار', pin: { lat: 32.887, lng: 45.0765 }, note: 'البيت الثالث بعد الفرن', photoIds: [], shareWithHousehold: true });
      }
      await ledger.recordAll(group(`demo:hh:${household.id}`, 'money', ago(30), [{ type: 'credit_issued', amount: 60_000, fromAccount: Accounts.bank, toAccount: Accounts.household(household.id), memo: 'topup:agent' }]));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ householdId: household.id, homeId: home.id }));
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err?.stack ?? err));
    }
  });
}

await app.listen(PORT);
console.log(`DEMO_API ready http://127.0.0.1:${PORT}/trpc (restaurant ${rest.id})`);
