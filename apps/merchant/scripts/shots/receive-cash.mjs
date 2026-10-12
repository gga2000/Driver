// «استلمت منه» on the Money screen: a courier holding the restaurant's cash hands it over at the
// counter; the owner checks the amount (never more than he holds) and types the courier's daily
// code from his app. Seeded by scripts/demo/money.mjs (`/demo/money/courier-code`).
import { scrollPage } from './money.mjs';

export default {
  name: 'receive-cash',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await byTestId(phone ? 'tab-money' : 'nav-money').click();
    await byTestId('money').waitFor();
    await byTestId('holders').waitFor({ timeout: 15_000 });
    const top = await demoPost('/demo/money/courier-code');
    if (!top?.courierId) throw new Error('no courier holds the cash');
    const button = byTestId(`receive-${top.courierId}`);
    if (phone) await scrollPage(page, 'money', 0.5);
    await button.scrollIntoViewIfNeeded();
    await shot('holders', { ...(phone ? {} : { element: byTestId('holders') }) });

    await button.click();
    await byTestId('receive-sheet').waitFor();
    await shot('sheet');

    // More than he holds: the amount is refused before anything is sent.
    await byTestId('receive-amount').fill(String(top.amountIqd + 1000));
    await shot('too-much');
    await byTestId('receive-amount').fill(String(top.amountIqd));

    // A wrong code: the server refuses it (the same lockout as field ops).
    const wrong = top.code === '0000' ? '1111' : '0000';
    await byTestId('receive-code').fill(wrong);
    await byTestId('receive-confirm').click();
    await page.waitForTimeout(1200);
    await shot('wrong-code');

    await byTestId('receive-code').fill(top.code);
    await shot('ready');
    await byTestId('receive-confirm').click();
    await byTestId('receipt-sheet').waitFor({ timeout: 15_000 });
    await shot('receipt');
  },
};
