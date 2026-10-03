// Wave 2 menu shots: the menu (sections | dishes on a tablet, chips on a phone), what's off filters,
// sold out today with undo, search, section order, the dish editor (price + history, options, photo),
// a new dish, and the menu-from-photos import (photos → correction table → added).
// Seeded by scripts/demo/menu.mjs; POST /demo/menu/reset puts the toggles back first.

/** A photo the picker hands over: an HTML page rendered to PNG (a paper menu, or a plate). */
async function render(page, html, size) {
  const p = await page.context().newPage();
  await p.setViewportSize(size);
  await p.setContent(`<html dir="rtl"><body style="margin:0">${html}</body></html>`);
  const buffer = await p.screenshot({ type: 'png' });
  await p.close();
  return buffer;
}

const paperMenu = (title, rows) => `
<div style="width:600px;height:800px;background:#f6efe0;font-family:'Noto Naskh Arabic','Noto Sans Arabic',serif;padding:48px;box-sizing:border-box;color:#2b2016;border:14px solid #8a5a2b">
  <div style="text-align:center;font-size:44px;font-weight:700">مطعم خالد</div>
  <div style="text-align:center;font-size:28px;margin:6px 0 28px;color:#8a5a2b">${title}</div>
  ${rows.map(([n, p]) => `<div style="display:flex;justify-content:space-between;font-size:30px;padding:12px 0;border-bottom:2px dotted #b99a6b"><span>${n}</span><span style="font-family:sans-serif">${p}</span></div>`).join('')}
</div>`;

const plate = `<div style="width:640px;height:480px;background:radial-gradient(circle at 50% 55%,#fbf6ee 0 150px,#e8dccb 151px 165px,transparent 166px),repeating-linear-gradient(90deg,#9b6a3e 0 22px,#a87648 22px 44px);display:flex;align-items:center;justify-content:center">
  <div style="width:210px;height:150px;border-radius:50%;background:radial-gradient(circle at 40% 40%,#d8a25a,#9c5a22);box-shadow:0 0 0 18px rgba(80,140,60,.55)"></div></div>`;

async function choose(page, trigger, files) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger.click()]);
  await chooser.setFiles(files);
}

export default {
  name: 'menu',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    await demoPost('/demo/menu/reset');
    await demoPost('/demo/board/store?open=1&busy=0');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();

    // The menu: first section (تكة) on a tablet, every section stacked on a phone.
    await byTestId(phone ? 'tab-menu' : 'nav-menu').click();
    await byTestId('menu').waitFor();
    await page.locator('[data-testid^="menu-item-"]').first().waitFor({ timeout: 15_000 });
    await shot('menu', { wait: 1200 });
    if (phone) await shot('menu-full', { full: true });

    // مشويات: the kebab by weight sold out today.
    await byTestId(phone ? 'menu-cat-2' : 'menu-cat-2').click();
    await shot('section-grills');

    // Filters: what's away right now.
    await byTestId('filter-sold-out').click();
    await shot('filter-sold-out');
    await byTestId('filter-off').click();
    await shot('filter-off');
    await byTestId('filter-all').click();

    // "خلص اليوم" on a dish: instant, with undo.
    await byTestId(phone ? 'menu-cat-1' : 'menu-cat-1').click();
    await page.locator('[data-testid^="menu-soldout-"]').first().click();
    await page.waitForTimeout(500);
    await shot('sold-out-toast', { wait: 300 });
    await page.waitForTimeout(4500);

    // Search across sections.
    await page.locator('[data-testid="menu-search"]').fill('كص');
    await shot('search');
    await page.locator('[data-testid="menu-search"]').fill('');

    // Section order.
    if (phone) await byTestId('menu-cat-all').click();
    await byTestId('menu-reorder').click();
    await byTestId('reorder-sheet').waitFor();
    await byTestId('reorder-up-3').click();
    await shot('reorder');
    await byTestId('reorder-sheet-close').click();

    // The dish editor: لفة تكة (photo, price with history, bread / sauce options).
    await byTestId(phone ? 'menu-cat-0' : 'menu-cat-0').click();
    await page.locator('[data-testid^="menu-item-"]:visible', { hasText: 'لفة تكة' }).first().getByRole('button').first().click();
    await byTestId('item-editor').waitFor();
    await byTestId('price-panel').waitFor();
    await shot('item', { wait: 1000 });
    if (phone) await shot('item-full', { full: true });
    await byTestId('price-history').click();
    await byTestId('history-sheet').waitFor();
    await shot('price-history', { wait: 900 });
    await byTestId('history-sheet-close').click();
    await byTestId('price-edit').click();
    await byTestId('price-sheet').waitFor();
    await page.locator('[data-testid="price-input"]').fill('2600');
    await shot('price-edit');
    await page.locator('[data-testid="price-input"]').fill(phone ? '3000' : '2750');
    await byTestId('price-save').click();
    await page.waitForTimeout(900);
    await shot('price-saved');
    await byTestId('group-0').click();
    await byTestId('group-sheet').waitFor();
    await shot('options-group');
    await byTestId('group-sheet-close').click();

    // Photo replace on a dish without one (كص لحم بالكيلو).
    await page.goBack();
    await byTestId('menu').waitFor();
    await byTestId('menu-cat-1').click();
    await page.locator('[data-testid^="menu-item-"]:visible', { hasText: 'كص لحم بالكيلو' }).first().getByRole('button').first().click();
    await byTestId('item-editor').waitFor();
    await shot('item-no-photo', { wait: 900 });
    await choose(page, byTestId('photo-library'), { name: 'gus.png', mimeType: 'image/png', buffer: await render(page, plate, { width: 640, height: 480 }) });
    await page.waitForTimeout(2000);
    await shot('photo-replaced', { wait: 900 });

    // A new dish in the open section.
    await page.goBack();
    await byTestId('menu').waitFor();
    await byTestId('menu-add-item').click();
    await byTestId('item-editor').waitFor();
    await page.locator('[data-testid="item-name"]').fill('لفة كص بالجبن');
    await page.locator('[data-testid="item-price"]').fill('3250');
    await shot('new-item');

    // Menu from photos: two pages → the correction table → added.
    await page.goBack();
    await byTestId('menu').waitFor();
    await byTestId('menu-import').click();
    await byTestId('menu-import-screen').waitFor();
    await shot('import-start');
    const pages = [
      { name: 'menu-1.png', mimeType: 'image/png', buffer: await render(page, paperMenu('الحلويات', [['كنافة', '3,000'], ['زلابية', '2,000'], ['بقلاوة كيلو', '12,000'], ['حلاوة جزر', '2,500']]), { width: 600, height: 800 }) },
      { name: 'menu-2.png', mimeType: 'image/png', buffer: await render(page, paperMenu('العصائر', [['عصير رمان', '2,500'], ['عصير برتقال', '2,000'], ['موهيتو', '3,000']]), { width: 600, height: 800 }) },
    ];
    await choose(page, byTestId('import-pick'), pages);
    await page.waitForTimeout(800);
    await shot('import-photos');
    await byTestId('import-start').click();
    await byTestId('import-table').waitFor({ timeout: 20_000 });
    const rows = [
      ['كنافة', '3000', 'حلويات'],
      ['زلابية', '2000', 'حلويات'],
      ['بقلاوة كيلو', '12,000', 'حلويات'],
      ['حلاوة جزر', '', 'حلويات'],
    ];
    for (const [i, [name, price, section]] of rows.entries()) {
      if (i > 0) await byTestId('import-add-row').click();
      await page.locator(`[data-testid="import-name-${i}"]`).fill(name);
      await page.locator(`[data-testid="import-price-${i}"]`).fill(price);
      await page.locator(`[data-testid="import-section-${i}"]`).fill(section);
    }
    await shot('import-review', { wait: 1200 });
    if (phone) await shot('import-review-full', { full: true });
    await page.locator('[data-testid="import-price-3"]').fill('2500');
    await byTestId('import-apply').click();
    await byTestId('import-done').waitFor({ timeout: 15_000 });
    await shot('import-done');
    await byTestId('import-to-menu').click();
    await byTestId('menu').waitFor();
    await demoPost('/demo/menu/reset');
  },
};
