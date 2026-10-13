// أكل بيت, the cook's side: «أكلاتي» (today's plates, reserved dishes, the reservations coming), a
// dish turned on for today, a new reserved dish. Seeded by scripts/demo/home-kitchen.mjs.
export default {
  name: 'home-kitchen',
  viewports: ['phone', 'tablet'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn } = h;
    await demoPost('/demo/home-kitchen/reset');
    await signIn('0770 888 0000');
    await byTestId('board').waitFor();
    await page.goto(new URL('/more', page.url()).href);
    await byTestId('more-home-kitchen').waitFor();
    await shot('shop-entry', { wait: 800 });

    await byTestId('more-home-kitchen').click();
    await byTestId('home-kitchen-reservations').waitFor();
    await shot('dishes', { wait: 800 });
    await byTestId('home-kitchen-reservations').scrollIntoViewIfNeeded();
    await shot('reservations', { wait: 600 });

    // She isn't cooking her last ready dish today: switched off, it leaves the customer menu.
    await byTestId('home-kitchen-ready').scrollIntoViewIfNeeded();
    await page.locator('[data-testid^="home-kitchen-on-"]').last().click();
    await page.waitForTimeout(1500);
    await shot('one-off', { wait: 600 });

    await byTestId('home-kitchen-add').click();
    await byTestId('home-dish-name').waitFor();
    await page.locator('[data-testid="home-dish-name"] input, input[data-testid="home-dish-name"]').first().fill('كبة حلب');
    await page.locator('[data-testid="home-dish-line"] input, input[data-testid="home-dish-line"]').first().fill('كبة تمن محشية لحم مثروم وكشمش');
    await page.locator('[data-testid="home-dish-price"] input, input[data-testid="home-dish-price"]').first().fill('5000');
    await byTestId('home-dish-mode-reserve').click();
    await page.waitForTimeout(500);
    await shot('new-details', { wait: 600 });
    await byTestId('home-dish-save').scrollIntoViewIfNeeded();
    await shot('new-reserved', { wait: 600 });
  },
};
