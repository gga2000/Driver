// «جهّز محلك» shots: a new shop's first day (scripts/demo/setup.mjs, owner 0770 777 0001). The welcome,
// his own shop page with the gaps lit, what he sells, the menu as yes/fix cards (and the fix sheet),
// a photo for every dish, hours in one tap, the counter list, the board's setup card, the shutter going
// up and «مبروك», and the first real order's gold ribbon.

const OWNER = '0770 777 0001';

export default {
  name: 'setup',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, goto, viewport, origin } = h;
    const phone = viewport === 'phone';
    const visible = (id) => page.locator(`[data-testid="${id}"]:visible`).first();
    const reload = async (path) => {
      await page.goto(`${origin}${path}`, { waitUntil: 'load' });
    };

    // 1 · He signs in for the first time: the board sends him to setup, which says hello.
    await demoPost('/demo/setup/stage?to=fresh');
    await signIn(OWNER);
    await visible('setup-welcome').waitFor({ timeout: 20_000 });
    await shot('01-welcome', { wait: 1200 });
    await visible('setup-welcome-go').click();

    // 2 · His shop first: the ring, the gaps, one next step.
    await visible('setup-list').waitFor();
    await visible('setup-hello').waitFor();
    await shot('02-shop', { wait: 1500 });
    if (phone) {
      // The phone scrolls inside the screen: the steps list below the preview.
      await visible('setup-next').scrollIntoViewIfNeeded();
      await shot('02-shop-steps', { wait: 600 });
      await page.mouse.wheel(0, -4000);
    }

    // 3 · What he sells.
    await visible('setup-step-kind').click();
    await visible('setup-door-meal').waitFor();
    await shot('03-kind', { wait: 900 });

    // 4 · The menu as cards (field ops photographed the wall; Driver wrote 14 dishes).
    await goto('/setup/menu');
    await visible('setup-card-ok').waitFor({ timeout: 15_000 });
    await shot('04-cards', { wait: 1500 });
    await visible('setup-card-fix').click();
    await visible('setup-fix').waitFor();
    await shot('04-fix', { wait: 900 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 5 · Hours in one tap.
    await goto('/setup/hours');
    await visible('setup-preset-lunch_dinner').waitFor();
    await shot('05-hours', { wait: 900 });

    // 6 · The counter list.
    await goto('/setup/counter');
    await visible('setup-check-practice').waitFor();
    await shot('06-counter', { wait: 900 });

    // The board keeps the setup card (phone: in the empty «جديد»; tablet: beside «الطلبات تجي هنا»).
    await goto('/');
    await visible(phone ? 'board-setup' : 'board-setup-tablet').waitFor({ timeout: 15_000 });
    await shot('board-card', { wait: 1500 });

    // Half way: kind confirmed, 10 cards answered, the falafel without a photo.
    await demoPost('/demo/setup/stage?to=cards');
    await reload('/setup/photos');
    await visible('setup-photos-score').waitFor({ timeout: 20_000 });
    await shot('04-photos', { wait: 1500 });
    await reload('/setup');
    await visible('setup-list').waitFor({ timeout: 20_000 });
    await shot('02-shop-half', { wait: 1500 });

    // 7 · Every step done: the shutter is his to raise.
    await demoPost('/demo/setup/stage?to=ready');
    await reload('/setup/open');
    await visible('setup-shutter').waitFor({ timeout: 20_000 });
    await shot('07-shutter', { wait: 1200 });
    const box = await visible('setup-shutter').boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 50);
      await page.mouse.down();
      // Slowly, a third of the way (no flick): the shutter follows his finger, then falls back down.
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height - 50 - i * box.height * 0.03);
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(250);
      await shot('07-shutter-drag', { wait: 150 });
      await page.waitForTimeout(400);
      await page.mouse.up();
      await page.waitForTimeout(900);
    }

    // 8 · «مبروك».
    if (await visible('setup-raise').isVisible()) await visible('setup-raise').click();
    await visible('setup-congrats').waitFor({ timeout: 20_000 });
    await shot('08-congrats', { wait: 1500 });

    // The first real order wears the gold ribbon.
    await demoPost('/demo/setup/first-order');
    await reload('/');
    // A live shop's board: the first-sign-in lesson, then the start-of-shift gate.
    if (await byTestId('learn-done').waitFor({ timeout: 6000 }).then(() => true, () => false)) await byTestId('learn-done').click();
    await h.startShift();
    await visible('first-order-ribbon').waitFor({ timeout: 20_000 });
    await shot('first-order', { wait: 1200 });

    await demoPost('/demo/setup/stage?to=fresh');
  },
};
