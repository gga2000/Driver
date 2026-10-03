// Wave 2 money shots: the cash account (cap, who holds it, "اطلب فلوسك" → courier on the way →
// handed over with the PIN, the receipt), today's sales, the weekly statement and disputes.
// Seeded by scripts/demo/money.mjs (+ lib/khalid-history.mjs).

/** Scrolls the screen's scroll view by `fraction` of its height (1 = to the end). */
export async function scrollPage(page, testId, fraction = 1) {
  await page.evaluate(
    ({ id, f }) => {
      const root = document.querySelector(`[data-testid="${id}"]`);
      const els = [...(root?.querySelectorAll('div') ?? [])].filter((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible');
      for (const e of els) e.scrollTop = f >= 1 ? e.scrollHeight : e.scrollHeight * f;
    },
    { id: testId, f: fraction },
  );
  await page.waitForTimeout(300);
}

export default {
  name: 'money',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';

    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await byTestId(phone ? 'tab-money' : 'nav-money').click();
    await byTestId('money').waitFor();
    await byTestId('cash-hero').waitFor({ timeout: 15_000 });

    // اليوم, before asking: the balance, cap bar and the button.
    if (await byTestId('request-on_the_way').isVisible().catch(() => false)) await demoPost('/demo/money/handover');
    await page.reload({ waitUntil: 'networkidle' });
    await byTestId('cash-hero').waitFor({ timeout: 15_000 });
    await byTestId('sales').waitFor({ timeout: 15_000 });
    await shot('today', { wait: 1200 });
    if (phone) {
      await scrollPage(page, 'money', 0.5);
      await shot('today-2');
      await scrollPage(page, 'money', 1);
      await shot('today-3');
      await scrollPage(page, 'money', 0);
    }

    // اطلب فلوسك → the courier holding the cash is routed.
    await byTestId('money-request').click();
    await byTestId('request-on_the_way').waitFor({ timeout: 20_000 });
    await shot('requested', { wait: 1200, ...(phone ? {} : { element: byTestId('cash-hero') }) });

    // He hands it over with the PIN.
    await demoPost('/demo/money/handover');
    await page.reload({ waitUntil: 'networkidle' });
    await byTestId('request-handed_over').waitFor({ timeout: 20_000 });
    await shot('handed-over', { wait: 1000 });
    await byTestId('request-receipt').click();
    await byTestId('receipt-sheet').waitFor();
    await shot('receipt');
    await byTestId('receipt-sheet-close').click();

    // كشف الأسبوع.
    await byTestId('segment-statement').click();
    await byTestId('statement-summary').waitFor({ timeout: 15_000 });
    const lines = await page.locator('[data-testid^="line-"]').count();
    if (lines < 15) {
      await byTestId('week-prev').click();
      await page.waitForTimeout(1500);
    }
    await shot('statement', { wait: 1200 });
    await scrollPage(page, 'money', 0.45);
    await shot('statement-2');
    await scrollPage(page, 'money', 0);

    // الشكاوى: list, one dispute's evidence, and contesting it.
    await byTestId('segment-disputes').click();
    await page.locator('[data-testid^="dispute-"]').first().waitFor({ timeout: 15_000 });
    await shot('disputes', { wait: 900 });
    await page.locator('[data-testid^="dispute-"]').first().click();
    await byTestId('dispute-sheet').waitFor();
    await shot('dispute');
    await byTestId('answer-contest').click();
    await page.locator('[data-testid="answer-note"]').fill('اللفات الأربع انحطت بالكيس، والكاشير عدّها قدام الدليفري');
    await shot('dispute-contest');
    await byTestId('dispute-sheet-close').click();
    // The contested one, with its photo.
    const contested = page.locator('[data-testid^="dispute-"]').nth(2);
    if (await contested.isVisible().catch(() => false)) {
      await contested.click();
      await byTestId('dispute-sheet').waitFor();
      await shot('dispute-answered', { wait: 1200 });
      await byTestId('dispute-sheet-close').click();
    }
  },
};
