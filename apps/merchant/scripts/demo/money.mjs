// Money section (wave 2): مطعم خالد's cash account, weekly statement and disputes.
//
// History (scripts/demo/lib/khalid-history.mjs): five weeks of orders posted to the ledger, couriers
// handing the cash over every evening with the PIN, Driver transferring the prepaid orders' net. The
// live balance is the last two hours (couriers holding it). Hand-over PIN 4821. Disputes: a missing
// item (fresh), a cold order (8 h left, urgent), a wrong item already contested with a photo, and an
// older one accepted.
//
//   POST /demo/money/request     "اطلب فلوسك" now (the courier holding most of the cash is routed)
//   POST /demo/money/handover    that courier hands it over with the PIN → the timeline completes
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { khalidHistory } from './lib/khalid-history.mjs';

const MIN = 60_000;
const HOUR = 60 * MIN;
export const HANDOVER_PIN = '4821';

/** A small warm PNG (paper bag on a counter) so the evidence thumbnail is a real image. */
function bagPhoto(w = 240, h = 240) {
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
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      let [r, g, b] = y > h * 0.72 ? [120 - (y - h * 0.72) * 0.3, 84, 52] : [236 - y * 0.12, 214 - y * 0.15, 180 - y * 0.2];
      const inBag = x > w * 0.28 && x < w * 0.72 && y > h * 0.22 && y < h * 0.8;
      if (inBag) [r, g, b] = [196 - (x - w * 0.28) * 0.25, 150 - (x - w * 0.28) * 0.2, 98];
      if (inBag && y < h * 0.3) [r, g, b] = [170, 124, 78];
      const sticker = Math.hypot(x - w * 0.5, y - h * 0.5) < w * 0.09;
      if (sticker) [r, g, b] = [224, 138, 30];
      raw[i] = Math.max(0, Math.min(255, r));
      raw[i + 1] = Math.max(0, Math.min(255, g));
      raw[i + 2] = Math.max(0, Math.min(255, b));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export default async function register(ctx) {
  const history = await khalidHistory(ctx);
  const { khalid } = ctx.stores;
  const owner = { personId: ctx.people.owner.id, sessionId: 'demo' };
  const { MerchantCashService } = await ctx.load('modules/ledger/index.js');
  const { EventsService } = await ctx.load('modules/events/index.js');
  const { ORDERS_REPOSITORY } = await ctx.load('modules/orders/index.js');
  const { MerchantAdminService } = await ctx.load('modules/merchant-admin/index.js');
  const { BLOB_STORE } = await ctx.load('modules/places/index.js');
  const cash = ctx.app.get(MerchantCashService);
  const events = ctx.app.get(EventsService);
  const repo = ctx.app.get(ORDERS_REPOSITORY);
  const admin = ctx.app.get(MerchantAdminService);
  const blobs = ctx.app.get(BLOB_STORE);

  await cash.configure(khalid.orgId, { mode: 'nightly_courier', pin: HANDOVER_PIN });

  // ── disputes ──
  const now = Date.now();
  const closed = history.orders.filter((o) => o.state === 'closed' && o.at && !o.pickup).sort((a, b) => b.at - a.at);
  // The most recent closed order before `hoursAgo` that has `key` in it (so the complaint matches the bag).
  const near = (hoursAgo, key) => closed.find((o) => o.at < now - hoursAgo * HOUR && (!key || o.keys.includes(key))) ?? closed.find((o) => o.at < now - hoursAgo * HOUR);
  const DISPUTES = [
    { order: near(3.5, 'tikka_wrap'), kind: 'missing_item', note: 'طلبنا لفات تكة ووحدة ناقصة', openedAgo: 3 * HOUR },
    { order: near(41, 'tikka_plate'), kind: 'cold_or_late', note: 'الأكل وصل بارد والتكة يابسة', openedAgo: 40 * HOUR },
    // Answered inside its 48-h window (an answer after it is refused).
    { order: near(31, 'kebab_plate'), kind: 'wrong_item', note: 'طلبت وجبة تكة وجاني كباب', openedAgo: 30 * HOUR, contest: 'الطلب بالتطبيق وجبة كباب، والكيس انطبع عليه صح. الصورة قبل ما نسلّمه للدليفري' },
    { order: near(150, 'lentil_soup'), kind: 'missing_item', note: 'الشوربة ما جت', openedAgo: 6 * 24 * HOUR, accept: true },
  ];
  const used = new Set();
  for (const d of DISPUTES) {
    if (!d.order || used.has(d.order.id)) continue;
    used.add(d.order.id);
    await repo.update(d.order.id, { state: 'disputed', closedAt: null });
    await events.emit(undefined, { actorId: d.order.ordererId, type: 'order.disputed', occurredAt: new Date(now - d.openedAgo), orderId: d.order.id, payload: { kind: d.kind, note: d.note, openedBy: 'customer' } }, { name: 'order', id: d.order.id });
    if (d.contest) {
      const bytes = bagPhoto();
      const ticket = await blobs.createUpload({ ownerId: owner.personId, contentType: 'image/png', sizeBytes: bytes.length });
      const url = new URL(ticket.uploadUrl, 'http://local');
      await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/png', bytes });
      await admin.moneyRespondDispute(owner, { merchantOrgId: khalid.orgId, orderId: d.order.id, decision: 'contest', note: d.contest, evidenceUploadIds: [ticket.uploadId] });
    }
    // Past its 48-h window the API refuses an answer (review #19): the default outcome simply stands.
    if (d.accept) await admin.moneyRespondDispute(owner, { merchantOrgId: khalid.orgId, orderId: d.order.id, decision: 'accept_default', evidenceUploadIds: [] }).catch(() => undefined);
  }

  // ── "اطلب فلوسك" hooks ──
  let lastPlan = null;
  ctx.route('/demo/money/request', async () => {
    lastPlan = await cash.requestSettlement(khalid.orgId, owner.personId, 'merchant_request');
    return lastPlan;
  });
  ctx.route('/demo/money/handover', async () => {
    const holders = await cash.holders(khalid.orgId);
    const courierId = lastPlan?.courierId ?? holders[0]?.courierId;
    const amount = holders.find((h) => h.courierId === courierId)?.amountIqd ?? 0;
    if (!courierId || amount <= 0) return { handedOver: 0 };
    const out = await cash.confirmHandover({ handoverId: `hv-live-${Date.now().toString(36)}`, courierId, merchantId: khalid.orgId, amountIqd: amount, merchantConfirmedIqd: amount, pin: HANDOVER_PIN });
    return { courierId, ...out };
  });
}
