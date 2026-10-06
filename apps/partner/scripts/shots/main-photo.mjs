// صورتك الرئيسية (Ali, 2026-10-06): the photo customers see. Courier: a new photo «تنتظر الموافقة» next to
// the approved one; tuktuk: the new one «مرفوضة» with the reason; rookie: none yet → the face guide, a
// picked photo in the circle; the account tab's header and row. Personas from scripts/demo/50-driver-account.mjs.
export const name = 'photo';

const PHONES = { courier: '0770 111 0001', tuktuk: '0770 111 0002', rookie: '0770 111 0041' };

/** A drawn selfie for the web file picker (rendered by the browser itself). */
async function selfie(p) {
  const page = await p.context.newPage();
  await page.setContent(`<html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="360" height="460" viewBox="0 0 360 460">
    <rect width="360" height="460" fill="#d9cbb5"/>
    <path d="M40 460c10-90 70-130 140-130s130 40 140 130z" fill="#2f4a5e"/>
    <rect x="150" y="270" width="60" height="70" rx="20" fill="#c99872"/>
    <ellipse cx="180" cy="200" rx="88" ry="108" fill="#d8a982"/>
    <path d="M92 175c0-75 45-108 90-108s88 30 88 104c-14-30-40-46-88-48-50 2-76 22-90 52z" fill="#2b1d14"/>
    <ellipse cx="148" cy="205" rx="9" ry="7" fill="#2b1d14"/><ellipse cx="212" cy="205" rx="9" ry="7" fill="#2b1d14"/></svg></body></html>`);
  const buf = await page.locator('svg').screenshot();
  await page.close();
  return buf;
}

export default async function run(s) {
  const c = await s.signIn(PHONES.courier);
  await c.goto('/photo');
  await c.wait('main-photo-latest');
  await c.shot('pending', { full: true, settle: 900 });
  await c.goto('/account');
  await c.wait('hub-photo');
  await c.shot('account', { settle: 900 });

  const tk = await s.signIn(PHONES.tuktuk);
  await tk.goto('/photo');
  await tk.wait('main-photo-reason');
  await tk.shot('rejected', { full: true, settle: 900 });

  const rk = await s.signIn(PHONES.rookie);
  await rk.goto('/photo');
  await rk.wait('main-photo-guide');
  await rk.shot('none', { full: true, settle: 900 });
  const buffer = await selfie(rk);
  const [chooser] = await Promise.all([rk.page.waitForEvent('filechooser', { timeout: 10_000 }), rk.byTestId('main-photo-library').click()]);
  await chooser.setFiles({ name: 'selfie.png', mimeType: 'image/png', buffer });
  await rk.wait('main-photo-preview');
  await rk.shot('preview', { full: true, settle: 900 });
  await rk.byTestId('main-photo-send').click();
  await rk.wait('main-photo-latest');
  await rk.shot('sent', { full: true, settle: 900 });
}
