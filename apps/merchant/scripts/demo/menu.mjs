// Menu section (wave 2): مطعم خالد's menu in the six sections a Kut grill uses — تكة، كص، مشويات، باجة،
// سلطات، مشروبات — with option groups (bread, sauce, size), a few dish photos (from the photo library), a price history, one dish sold out today and one switched off.
//
//   POST /demo/menu/reset     dishes back on sale, the gus by the kilo back to one price (undo a screenshot run)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A real dish photo from the API's photo library (apps/api/media/food), so the demo menu looks like a
 * shop's: the drawn placeholder plates read as brown blobs (day-one d21).
 */
function libraryPhoto(file) {
  return readFileSync(fileURLToPath(new URL(`../../../api/media/food/${file}.webp`, import.meta.url)));
}

export default async function register(ctx) {
  const { catalog } = ctx.services;
  const { khalid } = ctx.stores;
  const orgId = khalid.orgId;
  const { BLOB_STORE } = await ctx.load('modules/places/index.js');
  const blobs = ctx.app.get(BLOB_STORE);
  const { MerchantAdminService } = await ctx.load('modules/merchant-admin/index.js');
  const admin = ctx.app.get(MerchantAdminService);
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

  // Photos for some dishes, from the library.
  const PHOTOS = [
    ['tikka_wrap', 'lib-shawarma-1'],
    ['tikka_plate', 'lib-tikka-1'],
    ['gus_wrap', 'k-shawarma-2'],
    ['gus_plate', 'k-tikka-1'],
    ['kebab_plate', 'lib-kebab-1'],
    ['khalid_mix', 'lib-mixed-grill-1'],
    ['pacha', 'lib-pacha-2'],
    ['salad', 'lib-salad-1'],
  ];
  for (const [key, file] of PHOTOS) {
    const bytes = libraryPhoto(file);
    const ticket = await blobs.createUpload({ ownerId: ctx.people.owner.id, contentType: 'image/webp', sizeBytes: bytes.length });
    const url = new URL(ticket.uploadUrl, 'http://local');
    await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp'), sig: url.searchParams.get('sig'), contentType: 'image/webp', bytes });
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
    // Through the merchant-admin service, as the app does: the owner's «مين سوّى شنو» shows who.
    await admin.menuSoldOutToday({ personId: ctx.people.ali.id, sessionId: 'demo' }, { merchantOrgId: orgId, itemId: id('kebab_kilo') });
    await admin.menuSetAvailability({ personId: ctx.people.multi.id, sessionId: 'demo' }, { merchantOrgId: orgId, itemId: id('tabbouleh'), available: false });
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
