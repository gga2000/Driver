// The weekly statement's rate line (Ali 2026-10-11): «عمولتك هسة 12%» on base, and on starter the day
// the starter period began. `/demo/money/tier` switches مطعم خالد's tier for the second shot.
export default {
  name: 'commission-rate',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    const statement = async () => {
      await byTestId(phone ? 'tab-money' : 'nav-money').click();
      await byTestId('money').waitFor();
      await byTestId('segment-statement').click();
      await byTestId('statement-rate').waitFor({ timeout: 15_000 });
      // On a phone the statement sits below the day's cards.
      if (phone) await byTestId('statement-rate').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    };

    await demoPost('/demo/money/tier?tier=base');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await statement();
    await shot('base', { wait: 1200, ...(phone ? {} : { element: byTestId('statement-summary') }) });

    await demoPost('/demo/money/tier?tier=starter');
    await page.reload({ waitUntil: 'load' });
    await byTestId('board').waitFor().catch(() => undefined);
    await statement();
    await shot('starter', { wait: 1200, ...(phone ? {} : { element: byTestId('statement-summary') }) });
    await demoPost('/demo/money/tier?tier=base');
  },
};
