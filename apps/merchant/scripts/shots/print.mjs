// Print redesign «الريل» shots: the printer settings (width from the ruler, slip, stub, copies, bags,
// beep, cut, stations, cups) beside the true-size preview on a tablet; on a phone the settings
// (full page) and «اطبع وصل تجربة» opening the preview sheet (kitchen ticket, cut, customer slip),
// then the 58 mm width and the ruler ticket.
export default {
  name: 'print',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, signIn, goto, viewport } = h;
    await signIn('0770 123 4567');
    await goto('/printer');
    await byTestId('printer').waitFor({ timeout: 15_000 });
    await byTestId('printer-width').waitFor();
    await shot('settings', { wait: 900 });
    // The page scrolls inside its own view: wheel down for the rest of the settings.
    await page.mouse.move(viewport === 'phone' ? 200 : 900, 500);
    for (const n of [2, 3, 4]) {
      await page.mouse.wheel(0, 700);
      await shot(`settings-${n}`, { wait: 500 });
    }

    await byTestId('printer-test').click();
    await byTestId('receipt-preview').waitFor({ timeout: 10_000 });
    await shot('preview', { wait: 900 });
    const vp = page.viewportSize();
    await page.mouse.move(vp.width / 2, vp.height / 2);
    for (const n of [2, 3, 4]) {
      await page.mouse.wheel(0, 900);
      await shot(`preview-${n}`, { wait: 500 });
    }
    await page.keyboard.press('Escape');
    await byTestId('receipt-preview').waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);

    await byTestId('printer-width-384').scrollIntoViewIfNeeded();
    await byTestId('printer-width-384').click();
    await shot('settings-58', { wait: 900 });
    await byTestId('printer-calibrate').click();
    await byTestId('receipt-preview').waitFor({ timeout: 10_000 });
    await shot('ruler', { wait: 900 });
  },
};
