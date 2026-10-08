// Menu section (wave 2): مطعم خالد's menu in the six sections a Kut grill uses — تكة، كص، مشويات، باجة،
// سلطات، مشروبات — with option groups (bread, sauce, size), a few dish photos (drawn placeholders: a
// plate on a warm table), a price history, one dish sold out today and one switched off.
//
//   POST /demo/menu/reset     dishes back on sale, the gus by the kilo back to one price (undo a screenshot run)
import { Buffer } from 'node:buffer';
import { deflateSync, crc32 } from 'node:zlib';

/** A 400×300 PNG "photo": warm table, a plate, and food in the dish's colour. */
function platePng(food, seed = 0) {
  const W = 400;
  const H = 300;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  const [fr, fg, fb] = food;
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (W * 3 + 1) + 1 + x * 3;
      // table: warm wood with soft stripes
      const stripe = Math.sin((y + seed * 13) / 9) * 6;
      let r = 168 + stripe - y * 0.08;
      let g = 112 + stripe * 0.7 - y * 0.06;
      let b = 70 + stripe * 0.4;
      const dx = x - W / 2;
      const dy = (y - H / 2) * 1.25;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 130) {
        // shadow ring, then plate rim, then plate
        const plate = d < 122 ? 246 - Math.max(0, d - 100) * 0.6 : 210;
        r = plate;
        g = plate - 6;
        b = plate - 16;
      }
      // food: lumpy blob
      const wob = 72 + 10 * Math.sin(Math.atan2(dy, dx) * 5 + seed) + 6 * Math.sin(Math.atan2(dy, dx) * 9 + seed * 2);
      if (d < wob) {
        const shade = 1 - (d / wob) * 0.35 + 0.08 * Math.sin(x / 7 + seed) * Math.cos(y / 6);
        r = fr * shade;
        g = fg * shade;
        b = fb * shade;
      }
      raw[o] = Math.max(0, Math.min(255, r));
      raw[o + 1] = Math.max(0, Math.min(255, g));
      raw[o + 2] = Math.max(0, Math.min(255, b));
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export default async function register(ctx) {
  const { catalog } = ctx.services;
  const { khalid } = ctx.stores;
  const orgId = khalid.orgId;
  const { BLOB_STORE } = await ctx.load('modules/places/index.js');
  const blobs = ctx.app.get(BLOB_STORE);
  const id = (key) => khalid.itemIds.get(key);

  const bread = { nameAr: 'الخبز', required: true, minSelect: 1, maxSelect: 1, modifiers: [{ nameAr: 'صمون حجري', priceIqd: 0 }, { nameAr: 'خبز تنور', priceIqd: 250 }, { nameAr: 'لواش', priceIqd: 0 }] };
  const sauces = { nameAr: 'الصوص', required: false, minSelect: 0, maxSelect: 2, modifiers: [{ nameAr: 'عمبة', priceIqd: 0 }, { nameAr: 'ثومية', priceIqd: 0 }, { nameAr: 'حار', priceIqd: 0 }] };
  const extras = { nameAr: 'إضافات', required: false, minSelect: 0, maxSelect: 3, modifiers: [{ nameAr: 'جبن', priceIqd: 500 }, { nameAr: 'بطاطا', priceIqd: 750 }, { nameAr: 'بيض', priceIqd: 500, available: false }] };
  const size = (extra) => ({ nameAr: 'الحجم', required: true, minSelect: 1, maxSelect: 1, modifiers: [{ nameAr: 'نفر', priceIqd: 0 }, { nameAr: 'نفرين', priceIqd: extra }] });

  // New dishes (gus, pacha, salads, drinks) next to the launch seed and the board's extras.
  const NEW = [
    { key: 'chicken_gus_wrap', nameAr: 'لفة كص دجاج', priceIqd: 2500, prepTimeMin: 8, description: 'كص دجاج متبّل على السيخ، ويا طماطة وخيار مخلل', groups: [bread, sauces, extras] },
    { key: 'gus_kilo', nameAr: 'كص لحم بالكيلو', priceIqd: 18000, prepTimeMin: 15, description: 'ويا خبز وسلطة وعمبة لـ 3 أشخاص', groups: [] },
    { key: 'pacha_tongue', nameAr: 'لسانات', priceIqd: 4000, prepTimeMin: 8, description: 'لسان غنم مسلوق ويا ماي الباجة', groups: [] },
    { key: 'pacha_trotters', nameAr: 'كوارع', priceIqd: 3500, prepTimeMin: 8, description: 'ويا تشريب خبز', groups: [] },
    { key: 'pacha_broth', nameAr: 'تشريب باجة', priceIqd: 2500, prepTimeMin: 5, description: 'خبز مشرّب بماي الباجة، ويا ليمون', groups: [] },
    { key: 'jajeek', nameAr: 'جاجيك', priceIqd: 1500, prepTimeMin: 3, groups: [] },
    { key: 'tabbouleh', nameAr: 'تبولة', priceIqd: 2000, prepTimeMin: 5, groups: [] },
    { key: 'laban', nameAr: 'لبن أربيل', priceIqd: 750, prepTimeMin: 1, groups: [] },
    { key: 'tea', nameAr: 'چاي', priceIqd: 500, prepTimeMin: 2, description: 'استكان، ويا هيل', groups: [] },
  ];
  for (const n of NEW) {
    const created = await catalog.addItem({ id: `${orgId}_${n.key}`, orgId, nameAr: n.nameAr, priceIqd: n.priceIqd, prepTimeMin: n.prepTimeMin, description: n.description ?? null, modifierGroups: n.groups });
    khalid.itemIds.set(n.key, created.id);
  }

  // Sections in the order the kitchen wants them.
  const SECTIONS = [
    ['تكة', ['tikka_wrap', 'chicken_tikka_wrap', 'tikka_plate', 'lamb_tikka_plate']],
    ['كص', ['gus_wrap', 'chicken_gus_wrap', 'gus_plate', 'gus_kilo']],
    ['مشويات', ['kebab_wrap', 'liver_wrap', 'kebab_plate', 'liver_plate', 'kebab_kilo', 'khalid_mix', 'grill_mix_kilo']],
    ['باجة', ['pacha', 'pacha_tongue', 'pacha_trotters', 'pacha_broth']],
    ['سلطات', ['salad', 'jajeek', 'tabbouleh', 'torshi', 'lentil_soup']],
    ['مشروبات', ['pepsi', 'water', 'shenina', 'laban', 'tea']],
  ];
  for (const [nameAr, keys] of SECTIONS) await catalog.upsertCategory(orgId, { nameAr, itemIds: keys.map(id).filter(Boolean) });
  await catalog.reorderCategories(orgId, SECTIONS.map(([n]) => n));

  // Options on the wraps that had none and on the plates (the launch seed has bread on wraps).
  await catalog.setModifiers(orgId, id('gus_wrap'), [bread, sauces, extras]);
  await catalog.setModifiers(orgId, id('gus_plate'), [size(5500)]);
  await catalog.setModifiers(orgId, id('lamb_tikka_plate'), [size(8000)]);
  await catalog.upsertItem(orgId, { itemId: id('gus_plate'), patch: { description: 'كص لحم على السيخ، ويا تمن وسلطة وعمبة' } }, ctx.people.owner.id);
  await catalog.upsertItem(orgId, { itemId: id('pacha'), patch: { description: 'رأس كامل: لحم، لسان ومخ، ويا تشريب وخبز' } }, ctx.people.owner.id);

  // Photos for some dishes (warm placeholders drawn above).
  const PHOTOS = [
    ['tikka_wrap', [176, 92, 44]],
    ['tikka_plate', [186, 98, 50]],
    ['gus_wrap', [198, 140, 82]],
    ['gus_plate', [190, 128, 70]],
    ['kebab_plate', [150, 78, 44]],
    ['khalid_mix', [160, 86, 48]],
    ['pacha', [214, 186, 150]],
    ['salad', [96, 150, 70]],
  ];
  for (const [i, [key, colour]] of PHOTOS.entries()) {
    const bytes = platePng(colour, i);
    const ticket = await blobs.createUpload({ ownerId: ctx.people.owner.id, contentType: 'image/png', sizeBytes: bytes.length });
    const url = new URL(ticket.uploadUrl, 'http://local');
    await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp'), sig: url.searchParams.get('sig'), contentType: 'image/png', bytes });
    await catalog.replacePhoto(orgId, id(key), `upload:${ticket.uploadId}`);
  }

  // Price history: tikka went up twice this year, the gus plate came down.
  await catalog.updatePrice(orgId, id('tikka_wrap'), 2000, ctx.people.owner.id);
  await catalog.updatePrice(orgId, id('tikka_wrap'), 2250, ctx.people.owner.id);
  await catalog.updatePrice(orgId, id('tikka_wrap'), 2500, ctx.people.owner.id);
  await catalog.updatePrice(orgId, id('gus_plate'), 7000, ctx.people.owner.id);
  await catalog.updatePrice(orgId, id('gus_plate'), 6500, ctx.people.owner.id);

  // Tonight: the kebab by weight is sold out, the tabbouleh is off until parsley comes back.
  const state = async () => {
    for (const key of [...SECTIONS.flatMap(([, keys]) => keys)]) if (id(key)) await catalog.setAvailability(orgId, id(key), true);
    await catalog.soldOutToday(orgId, id('kebab_kilo'));
    await catalog.setAvailability(orgId, id('tabbouleh'), false);
    // The glass display shots (step 4) set the gus by the kilo to sell by weight: back to one price.
    await catalog.setModifiers(orgId, id('gus_kilo'), []);
    await catalog.updatePrice(orgId, id('gus_kilo'), 18000, ctx.people.owner.id);
  };
  await state();

  ctx.route('/demo/menu/reset', async () => {
    await state();
    return { ok: true };
  });
}
