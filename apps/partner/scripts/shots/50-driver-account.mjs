// Wave-2 driver account shots: الأرباح (day / week / last month, a bar and a job's receipt, the hand-over
// code), the statement, the scorecard (visible and month one), documents (all fine, mixed, expired,
// the upload sheet), the daily check-in (intro, move, selfie, failure, success, locked) and the home
// gate (banner + locked switch). Personas from scripts/demo/50-driver-account.mjs.
export const name = 'earnings';

const PHONES = { courier: '0770 111 0001', tuktuk: '0770 111 0002', rookie: '0770 111 0041', locked: '0770 111 0042', lapsed: '0770 111 0043' };

/** A drawn selfie / document photo to hand the web file picker (rendered by the browser itself). */
async function picture(p, kind) {
  const page = await p.context.newPage();
  const face = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="460" viewBox="0 0 360 460">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9cbb5"/><stop offset="1" stop-color="#a99577"/></linearGradient></defs>
    <rect width="360" height="460" fill="url(#bg)"/>
    <path d="M40 460c10-90 70-130 140-130s130 40 140 130z" fill="#2f4a5e"/>
    <rect x="150" y="270" width="60" height="70" rx="20" fill="#c99872"/>
    <ellipse cx="180" cy="200" rx="88" ry="108" fill="#d8a982"/>
    <path d="M92 175c0-75 45-108 90-108s88 30 88 104c-14-30-40-46-88-48-50 2-76 22-90 52z" fill="#2b1d14"/>
    <ellipse cx="148" cy="205" rx="9" ry="7" fill="#2b1d14"/><ellipse cx="212" cy="205" rx="9" ry="7" fill="#2b1d14"/>
    <path d="M132 186q16-8 30 0M198 186q16-8 30 0" stroke="#2b1d14" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M180 212v34q-8 6-16 2" stroke="#b07f5c" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M150 268q30 12 60 0q-10 26-30 26t-30-26z" fill="#2b1d14" opacity=".85"/>
    <path d="M155 270q25 14 50 0" stroke="#fff" stroke-width="4" fill="none"/></svg>`;
  const card = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="330" viewBox="0 0 520 330">
    <rect width="520" height="330" fill="#6d6152"/><rect x="20" y="20" width="480" height="290" rx="22" fill="#e9eef2"/>
    <rect x="20" y="20" width="480" height="64" rx="22" fill="#1f6f5b"/><rect x="20" y="62" width="480" height="22" fill="#1f6f5b"/>
    <rect x="48" y="110" width="120" height="150" rx="10" fill="#c9b49a"/><circle cx="108" cy="165" r="30" fill="#8a6a50"/>
    <rect x="196" y="120" width="250" height="16" rx="8" fill="#9aa7b1"/><rect x="196" y="156" width="200" height="14" rx="7" fill="#b7c1c9"/>
    <rect x="196" y="190" width="230" height="14" rx="7" fill="#b7c1c9"/><rect x="196" y="224" width="150" height="14" rx="7" fill="#b7c1c9"/></svg>`;
  await page.setContent(`<html><body style="margin:0">${kind === 'selfie' ? face : card}</body></html>`);
  const buf = await page.locator('svg').screenshot();
  await page.close();
  return buf;
}

async function choose(p, clickTestId, kind) {
  const buffer = await picture(p, kind);
  const [chooser] = await Promise.all([p.page.waitForEvent('filechooser', { timeout: 10_000 }), p.byTestId(clickTestId).click()]);
  await chooser.setFiles({ name: `${kind}.png`, mimeType: 'image/png', buffer });
}

export default async function run(s) {
  // ── courier: earnings, statement, scorecard, documents ────────────────
  await s.demoPost('/demo/clear?who=courier');
  const c = await s.signIn(PHONES.courier);
  await c.goto('/earnings');
  await c.wait('earnings-hero');
  await c.page.waitForTimeout(1200);
  await c.shot('day', { settle: 1200 });
  await c.shot('day-full', { full: true, settle: 400 });
  // Partner redesign e3 / e5: his best hours, and today's tips in green with the customer's words.
  await c.page.locator('[data-testid="best-time"]').scrollIntoViewIfNeeded();
  await c.shot('best-time', { settle: 600 });
  await c.page.locator('[data-testid="latest-jobs"]').scrollIntoViewIfNeeded();
  await c.shot('tips-words', { settle: 600 });
  // «يومك» (e7): the whole day, km and the best word, to keep or share.
  await c.page.locator('[data-testid="earnings-hero"]').scrollIntoViewIfNeeded();
  await c.byTestId('your-day').click();
  await c.wait('shift-stats');
  await c.shot('your-day', { settle: 1200 });
  await c.shot('your-day-full', { full: true, settle: 400 });
  await c.page.goBack();
  await c.wait('earnings-hero');

  await c.byTestId('segment-week').click();
  await c.page.getByText('هالأسبوع').first().waitFor();
  await c.page.waitForTimeout(1200);
  await c.shot('week', { settle: 1000 });
  // A bar tapped: that day's amount and jobs.
  await c.page.locator('[data-testid="earnings-chart"] [role="button"]').nth(4).click();
  await c.page.waitForTimeout(500);
  await c.shot('week-bar', { settle: 300 });
  // A job opens its receipt with every component (audit S-7: its own screen, not in place); then back.
  await c.page.locator('[data-testid="latest-jobs"] [role="button"]').first().click();
  await c.wait('receipt-head');
  await c.shot('week-job-open', { settle: 900 });
  await c.page.goBack();
  await c.wait('earnings-hero');

  await c.page.locator('[data-testid="earnings-hero"]').scrollIntoViewIfNeeded();
  await c.byTestId('segment-month').click();
  await c.page.waitForTimeout(600);
  await c.byTestId('period-prev').click();
  await c.page.getByText('الشهر الفات').first().waitFor();
  await c.page.waitForTimeout(1400);
  await c.shot('month-last', { settle: 800 });

  await c.byTestId('segment-day').click();
  await c.page.waitForTimeout(800);
  await c.byTestId('handover-cta').click();
  await c.wait('handover-code');
  await c.shot('handover', { settle: 900 });
  await c.byTestId('handover-close').click();
  await c.page.waitForTimeout(400);

  await c.goto('/earnings/statement?period=week');
  await c.wait('statement');
  await c.page.waitForTimeout(1000);
  await c.shot('statement-week', { full: true, settle: 800 });

  await c.goto('/scorecard');
  await c.wait('score-hero');
  await c.shot('scorecard', { settle: 1600 });
  await c.shot('scorecard-full', { full: true, settle: 400 });
  // f6: the five parts of his 100, and what customers say most.
  await c.page.locator('[data-testid="score-parts"]').scrollIntoViewIfNeeded();
  await c.shot('score-parts', { settle: 500 });
  await c.page.locator('[data-testid="score-words"]').scrollIntoViewIfNeeded();
  await c.shot('score-words', { settle: 500 });

  // His papers are fine; the new main photo he sent waits for approval (demo seed), so the summary says «دنراجع أوراقك».
  await c.goto('/documents');
  await c.wait('docs-summary-review');
  await c.shot('documents-review', { settle: 800 });
  // a1 / a2: the account in three groups under his approved photo.
  await c.goto('/account');
  await c.wait('hub-you');
  await c.shot('account', { settle: 1200 });
  await c.page.locator('[data-testid="hub-help"]').scrollIntoViewIfNeeded();
  await c.shot('account-help', { settle: 500 });
  await c.close();

  // ── tuktuk: the take, mixed documents and the upload sheet ─────────────
  const tk = await s.signIn(PHONES.tuktuk);
  // a3: his licence has 12 days left, so home says so (papers reach home only in their last 14 days).
  await tk.goto('/');
  await tk.wait('papers-banner');
  await tk.shot('home-papers', { settle: 1200 });
  await tk.goto('/earnings/statement?period=day');
  await tk.wait('statement-jobs');
  await tk.page.locator('[data-testid="statement-jobs"] [role="button"]').first().click();
  await tk.page.waitForTimeout(500);
  await tk.shot('statement-ride-take', { settle: 600 });
  await tk.goto('/documents');
  await tk.wait('docs-summary-action');
  await tk.shot('documents-mixed', { full: true, settle: 900 });
  await tk.byTestId('doc-vehicle_registration-action').click();
  await tk.wait('upload-sheet');
  await tk.shot('upload-sheet', { settle: 700 });
  await choose(tk, 'upload-library', 'card');
  await tk.wait('upload-preview');
  await tk.shot('upload-preview', { settle: 900 });
  await tk.byTestId('upload-submit').click();
  await tk.page.getByText('وصلتنا. نراجعها خلال 24 ساعة').first().waitFor({ timeout: 10_000 });
  await tk.shot('upload-sent', { settle: 600 });
  await tk.close();

  // ── rookie: home gate, month-one scorecard, the check-in flow ──────────
  const rk = await s.signIn(PHONES.rookie);
  await rk.wait('gate-banner-checkin');
  await rk.shot('home-checkin-needed', { settle: 1800 });
  await rk.goto('/scorecard');
  await rk.wait('score-observation');
  await rk.shot('scorecard-month-one', { full: true, settle: 1500 });

  await rk.goto('/checkin');
  await rk.wait('checkin-intro');
  await rk.shot('checkin-intro', { settle: 700 });
  await s.demoPost('/demo/account/fail-next-checkin?who=rookie');
  await rk.byTestId('checkin-start').click();
  await rk.wait('checkin-challenge');
  await rk.shot('checkin-move', { settle: 1300 });
  await choose(rk, 'checkin-shoot', 'selfie');
  await rk.wait('checkin-selfie');
  await rk.shot('checkin-preview', { settle: 700 });
  await rk.byTestId('checkin-send').click();
  await rk.wait('checkin-failed');
  await rk.shot('checkin-failed', { settle: 1000 });
  await rk.byTestId('checkin-retry').click();
  await rk.wait('checkin-challenge');
  await choose(rk, 'checkin-shoot', 'selfie');
  await rk.wait('checkin-selfie');
  await rk.byTestId('checkin-send').click();
  await rk.wait('checkin-passed');
  await rk.shot('checkin-passed', { settle: 1100 });
  await rk.byTestId('checkin-done').click();
  await rk.wait('online-switch');
  await rk.shot('home-unlocked', { settle: 1500 });
  await rk.close();

  // ── locked out, and an expired licence ─────────────────────────────────
  const lk = await s.signIn(PHONES.locked);
  await lk.wait('gate-banner-locked');
  await lk.shot('home-locked', { settle: 1500 });
  await lk.goto('/checkin');
  await lk.wait('checkin-locked');
  await lk.shot('checkin-locked', { settle: 1000 });
  await lk.close();

  const lp = await s.signIn(PHONES.lapsed);
  await lp.wait('gate-banner-document');
  await lp.shot('home-doc-expired', { settle: 1500 });
  await lp.goto('/documents');
  await lp.wait('docs-summary-blocked');
  await lp.shot('documents-expired', { settle: 900 });
  await lp.close();
}
