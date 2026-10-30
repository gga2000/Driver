// The owner corrects a dish's ticket kind (k4/j6 override, Ali 2026-10-09 "go ahead"): سحلب: a hot drink the name
// doesn't give away shows «تلقائي: أكل»; picking «مشروب ساخن» is what the kitchen ticket then shows.
export default {
  name: 'kind-override',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, goto } = h;
    await demoPost('/demo/board/store?open=1&busy=0');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await goto('/menu/item');
    await page.locator('[data-testid="item-name"]').fill('سحلب');
    const kind = byTestId('item-kind');
    await kind.waitFor();
    await kind.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot('auto', { wait: 600 });
    await kind.locator('[data-testid="chip-hot_drink"]').click();
    await shot('picked', { wait: 600 });
  },
};
