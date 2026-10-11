// Food carts (عربانات, Ali 2026-10-11), the owner's side: «فتحت هنا» with the day map (v1), tonight's
// orders with no ticket yet, three walk-over tickets coming in («جديدة»), the same after a reload (one
// ready, one late), «سدّيت الليلة؟», then «أوقاتك والإجازة» (usual hours and an away note).
// Seeded by scripts/demo/carts.mjs (`/demo/carts/close`, `/demo/carts/open`, `/demo/carts/tickets`).
export default {
  name: 'carts',
  viewports: ['phone', 'tablet'],
  async run(h) {
    const { page, origin, byTestId, shot, demoPost } = h;
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({ latitude: 32.90233, longitude: 45.06588 });

    await demoPost('/demo/carts/close');
    // h.signIn waits for the board; a cart owner lands on the cart screen instead.
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${origin}/welcome`, { waitUntil: 'load' });
    await byTestId('welcome-start').click();
    await page.locator('[data-testid="phone-input"]').fill('0770 123 4500');
    await byTestId('phone-submit').click();
    await byTestId('otp-dev-strip').waitFor({ timeout: 15_000 });
    const code = (await byTestId('otp-dev-strip').innerText()).match(/\d{6}/)?.[0];
    await page.locator('[data-testid="otp-input"]').fill(code ?? '');
    await byTestId('cart-open').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(3000);
    await shot('open', { wait: 800 });
    await shot('open-full', { full: true });

    await byTestId('cart-open-here').click();
    await byTestId('cart-tonight').waitFor({ timeout: 15_000 });
    await shot('tonight-empty');

    // The tickets come in while the screen is open: they chime and wear «جديدة».
    await demoPost('/demo/carts/tickets');
    await page.locator('[data-testid^="cart-fresh-"]').first().waitFor({ timeout: 15_000 });
    await shot('tickets-new');
    await page.reload({ waitUntil: 'load' });
    await byTestId('cart-tonight').waitFor({ timeout: 20_000 });
    await page.locator('[data-testid^="cart-ticket-"]').first().waitFor({ timeout: 15_000 });
    await shot('tickets');
    await shot('tickets-full', { full: true });

    await byTestId('cart-close').click();
    await byTestId('cart-close-yes').waitFor();
    await shot('close');
    await byTestId('cart-close-yes').click();
    await byTestId('cart-open').waitFor({ timeout: 15_000 });

    // «أوقاتك والإجازة»: usual hours and an away note, with the line people will read.
    await byTestId('cart-hours-row').click();
    await byTestId('cart-hours').waitFor({ timeout: 15_000 });
    await shot('hours', { full: true });
    await byTestId('cart-away-travel').click();
    await shot('hours-away');
    await byTestId('cart-hours-save').click();
    await byTestId('cart-open').waitFor({ timeout: 15_000 });
    await shot('open-away', { full: true });
  },
};
