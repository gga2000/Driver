// «جهّز محلك» (merchant setup): a brand-new shop that field ops signed up this morning and nobody has
// set up yet — مشويات الزهراء, owner «أبو حسن» on 0770 777 0001. Field ops already took the pickup-spot
// photo and photographed the menu on the wall; Driver's team wrote 14 dishes from it, waiting as yes/fix
// cards (one with no library photo close to it). Everything else is his: what he sells, the cards, the
// photos, the hours, how his money reaches him and a practice order — then he raises his own shutter.
// The demo shops (مطعم خالد and the rest) are not touched: they have storefronts, so they are "before
// setup" and never see any of it.
//
//   POST /demo/setup/reset                     a fresh shop again (a new org; the owner moves to it)
//   POST /demo/setup/stage?to=fresh|cards|ready|live
//        fresh  just signed up (the default)       cards  kind confirmed, 10 cards answered (4 left)
//        ready  every step done, shutter down      live   the shutter is up
//   POST /demo/setup/first-order               a live shop's first real order (the gold ribbon)
import { existsSync, readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { pickupWindowPng } from '../../../partner/scripts/door-photo.mjs';

const OWNER_PHONE = '07707770001';
const OWNER_NAME = 'أبو حسن';
const SHOP = 'مشويات الزهراء';
const KITCHEN = { zoneKey: 'zakur', pin: { lat: 32.8905, lng: 45.0712 } };

/** What Driver's team read off the wall board (14 rows; «سندويش فلافل خاص» has no library photo near it). */
const ROWS = [
  { nameAr: 'تكة غنم', priceIqd: 6000, categoryAr: 'مشويات' },
  { nameAr: 'كباب عراقي', priceIqd: 5000, categoryAr: 'مشويات' },
  { nameAr: 'مشويات مشكلة', priceIqd: 15000, categoryAr: 'مشويات' },
  { nameAr: 'دجاج مشوي نص', priceIqd: 7000, categoryAr: 'مشويات' },
  { nameAr: 'معلاك', priceIqd: 4000, categoryAr: 'مشويات' },
  { nameAr: 'شوربة عدس', priceIqd: 2000, categoryAr: 'شوربات' },
  { nameAr: 'تمن ومرق', priceIqd: 4000, categoryAr: 'أكلات' },
  { nameAr: 'باچة', priceIqd: 7000, categoryAr: 'أكلات' },
  { nameAr: 'شاورما لحم', priceIqd: 3000, categoryAr: 'سندويشات' },
  { nameAr: 'سندويش فلافل خاص', priceIqd: 1500, categoryAr: 'سندويشات' },
  { nameAr: 'زلاطة', priceIqd: 1000, categoryAr: 'مقبلات' },
  { nameAr: 'حمص', priceIqd: 1500, categoryAr: 'مقبلات' },
  { nameAr: 'لبن', priceIqd: 750, categoryAr: 'مشروبات' },
  { nameAr: 'چاي', priceIqd: 500, categoryAr: 'مشروبات' },
];
/** The library photo the owner keeps on each card (null: none fits, he skips the photo). */
const SLUGS = ['tikka', 'kebab', 'mixed-grill', 'chicken', 'liver', 'lentil-soup', 'timman-marag', 'pacha', 'shawarma', 'falafel', 'salad', 'hummus', 'laban', 'tea'];

// ── a drawn wall menu (cream board, date-brown lines of dishes and prices) ──
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
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
function menuBoardPng() {
  const W = 240;
  const H = 320;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const frame = x < 10 || x >= W - 10 || y < 10 || y >= H - 10;
      const row = Math.floor((y - 50) / 18);
      const inRow = y >= 50 && (y - 50) % 18 < 7 && row < 14;
      const title = y >= 22 && y < 34 && x > 60 && x < 180;
      const name = inRow && x > 110 && x < 220 - (row % 3) * 18;
      const price = inRow && x > 24 && x < 64;
      const [r, g, b] = frame ? [74, 40, 20] : title || name || price ? [42, 23, 12] : [255, 243, 226];
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The first photo the library keeps of a dish (some keep only their 2nd or 3rd take). */
const libraryFile = (slug) => {
  for (const n of [1, 2, 3]) {
    const p = fileURLToPath(new URL(`../../assets/dish-library/${slug}-${n}.webp`, import.meta.url));
    if (existsSync(p)) return p;
  }
  throw new Error(`no library photo for ${slug}`);
};

export default async function register(ctx) {
  const { orgs, identity, catalog, orders } = ctx.services;
  const { BLOB_STORE } = await ctx.load('modules/places/index.js');
  const { MerchantSetupService } = await ctx.load('modules/merchant/index.js');
  const blobs = ctx.app.get(BLOB_STORE);
  const setup = ctx.app.get(MerchantSetupService);
  const SYSTEM = { personId: 'system:demo', sessionId: 'demo' };

  const ownerId = await identity.ensurePersonByPhone(OWNER_PHONE, 'system:demo', 'demo');
  await identity.updateProfile({ personId: ownerId, sessionId: 'demo' }, { name: OWNER_NAME });
  ctx.people.setupOwner = { phone: OWNER_PHONE, id: ownerId };
  const owner = { personId: ownerId, sessionId: 'demo' };

  async function photo(bytes, contentType) {
    const ticket = await blobs.createUpload({ ownerId, contentType, sizeBytes: bytes.length });
    const url = new URL(ticket.uploadUrl, 'http://local');
    await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp'), sig: url.searchParams.get('sig'), contentType, bytes });
    return ticket.uploadId;
  }

  let shop = null;
  let seq = 0;

  /** A shop exactly as field ops leave it: location, pickup photo, the menu photo read into 14 cards. */
  async function fresh() {
    if (shop) await identity.revokeRole(SYSTEM, { personId: ownerId, kind: 'merchant_owner', orgId: shop.id });
    seq += 1;
    shop = await orgs.create({ type: 'restaurant', name: SHOP, cityId: 'aziziyah', ownerId });
    await orgs.setMerchantSettings(shop.id, { location: KITCHEN, commissionTier: 'base' });
    await identity.grantRole(SYSTEM, { personId: ownerId, kind: 'merchant_owner', orgId: shop.id });
    // The shop is new (no storefront): its first read starts «جهّز محلك», as for a real signed-up shop.
    await setup.adopt(shop);
    await orgs.setMerchantSettings(shop.id, { pickupSpot: { note: 'الاستلام من الشباك جنب الباب', photoRefs: [await photo(pickupWindowPng(), 'image/png')], updatedAt: new Date() } });
    const menuPhoto = await photo(menuBoardPng(), 'image/png');
    const job = await catalog.createImportJob(shop.id, [menuPhoto], 'demo-field-ops');
    await catalog.saveImportDraft(shop.id, job.id, ROWS.map((r) => ({ ...r, sourceUploadId: menuPhoto })));
    const s = await orgs.merchantSettings(shop.id);
    await orgs.setMerchantSettings(shop.id, { setup: { ...s.setup, menuJobId: job.id, cards: {} } });
    return shop;
  }

  async function answerCards(count) {
    const s = await orgs.merchantSettings(shop.id);
    const jobId = s.setup.menuJobId;
    for (let i = 0; i < Math.min(count, ROWS.length); i++) {
      const slug = SLUGS[i];
      const keep = slug && slug !== 'falafel' ? slug : null;
      const uploadId = keep ? await photo(readFileSync(libraryFile(keep)), 'image/webp') : undefined;
      await setup.answer(owner, { merchantOrgId: shop.id, jobId, index: i, answer: 'ok', ...(uploadId ? { uploadId, librarySlug: keep } : {}) });
    }
  }

  async function stage(to) {
    await fresh();
    if (to === 'fresh') return;
    await setup.confirmKinds(owner, { merchantOrgId: shop.id, kinds: ['meal'] });
    if (to === 'cards') return answerCards(10);
    await answerCards(ROWS.length);
    // The dish with no library photo gets his own photo (a plate).
    const menu = await catalog.adminMenu(shop.id);
    const bare = menu.find((i) => !i.photoUrl);
    if (bare) await setup.dishPhoto(owner, { merchantOrgId: shop.id, itemId: bare.id, uploadId: await photo(readFileSync(libraryFile('falafel')), 'image/webp'), librarySlug: null });
    // Open around the clock, so the demo takes orders at any hour.
    await orgs.setMerchantSettings(shop.id, { openingHours: Array.from({ length: 7 }, (_, dow) => ({ dow, start: '00:00', end: '23:59' })) });
    await setup.seePayout(owner, { merchantOrgId: shop.id });
    for (const check of ['sound', 'screen', 'practice']) await setup.check(owner, { merchantOrgId: shop.id, check });
    if (to === 'live') await setup.goLive(owner, { merchantOrgId: shop.id });
  }

  await stage('fresh');

  ctx.route('/demo/setup/reset', async () => {
    await stage('fresh');
    return { ok: true, orgId: shop.id, owner: OWNER_PHONE };
  });
  ctx.route('/demo/setup/stage', async (_req, _res, url) => {
    const to = url.searchParams.get('to') ?? 'fresh';
    if (!['fresh', 'cards', 'ready', 'live'].includes(to)) return { ok: false, error: 'to=fresh|cards|ready|live' };
    await stage(to);
    return { ok: true, orgId: shop.id, stage: to };
  });
  ctx.route('/demo/setup/first-order', async () => {
    const menu = await catalog.adminMenu(shop.id);
    const tikka = menu.find((i) => i.nameAr === 'تكة غنم') ?? menu[0];
    if (!tikka) return { ok: false, error: 'stage=live first' };
    const order = await orders.place(`demo-setup-customer-${seq}-${Date.now()}`, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: shop.id,
      paymentMethod: 'cash',
      dropoff: { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } },
      lines: [{ catalogItemId: tikka.id, qty: 2, modifiers: [] }],
    });
    return { ok: true, orderId: order.id };
  });
}
