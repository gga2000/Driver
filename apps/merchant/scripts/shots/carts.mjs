// Food carts (عربانات, Ali 2026-10-11), the owner's side: «فتحت هنا» with the day map (v1), tonight's
// orders with no ticket yet, then three walk-over tickets (one ready, one late), and «سدّيت الليلة؟».
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

    await demoPost('/demo/carts/tickets');
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
  },
};
