// Counter redesign step 3 shots (rush and busy): eight orders at once — one-line rows with their own
// button on a tablet (r2), the busy chip pulsing «زحمة؟» (r4) and the screen edge red in the last 30 s
// (a2/a8); busy mode on — the gold frame and the gold chip with the time it ends (r1, r3 on a phone)
// and «اقبل الكل» on the ribbon (t4); after accepting all; a cooking ticket dragged toward the ready
// lane (o9); and a fresh order in the middle 30 s of its ring (saffron edge). Seeded by
// scripts/demo/board.mjs (`/demo/board/rush`, `/demo/board/store`, `/demo/board/fresh`).
export default {
  name: 'busy',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    const has = async (id) => (await page.locator(`[data-testid="${id}"]`).count()) > 0;

    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/board/printer?state=connected');
    await demoPost('/demo/board/rush?count=8');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await page.locator('[data-testid^="order-"]').first().waitFor({ timeout: 15_000 });
    if (await byTestId('day-ok').isVisible().catch(() => false)) await byTestId('day-ok').click();
    await page.waitForTimeout(4500);
    await shot('rush', { wait: 600 });

    // Busy mode on from the chip (one tap away on a phone too): gold frame, gold chip, «اقبل الكل».
    await byTestId('busy-chip').click();
    await byTestId('busy-toggle').click();
    await byTestId('busy-frame').waitFor({ timeout: 15_000 });
    await shot('busy-on', { wait: 1200 });

    if (await has('accept-all')) {
      await byTestId('accept-all').click();
      await page.waitForTimeout(3000);
      await shot('accepted-all', { wait: 600 });
    }

    if (!phone) {
      // o9: a cooking ticket half-way toward «ينتظر الدليفري», then let go.
      const drag = page.locator('[data-testid^="drag-"]').first();
      if (await drag.count()) {
        const box = await drag.boundingBox();
        const y = box.y + 60;
        const x = box.x + box.width * 0.5;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 1; i <= 10; i++) await page.mouse.move(x - (box.width * 0.5 * i) / 10, y);
        await shot('drag', { wait: 300 });
        await page.mouse.up();
        await page.waitForTimeout(2500);
        await shot('dragged', { wait: 600 });
      }
    }

    // A fresh order in the middle 30 s of its ring: the saffron edge.
    await demoPost('/demo/board/fresh');
    await page.waitForTimeout(33_000);
    await shot('ring-middle', { wait: 400 });
  },
};
