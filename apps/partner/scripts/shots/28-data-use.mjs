// l6 «النت اللي صرفه التطبيق»: the Account card while online (this shift, and how far a 1 GB pack goes),
// the same card while off (today), and the line at the end of the shift summary. The demo shift started
// five hours ago, so the phone's counter is seeded with a believable five hours (about 14 MB) first;
// everything after that is the app's own counted traffic.
//
//   SHOTS=data-use node scripts/web-shots.mjs <out-dir>
export const name = 'data-use';

const KEY = 'driver.partner.data-usage';
const SLOT_MS = 15 * 60_000;

async function has(p, id, timeout = 4000) {
  try {
    await p.wait(id, timeout);
    return true;
  } catch {
    return false;
  }
}

async function scrollTo(p, id) {
  await p.byTestId(id).scrollIntoViewIfNeeded();
  await p.page.waitForTimeout(400);
}

async function scrollEnd(p) {
  await p.page.mouse.move(195, 400);
  for (let i = 0; i < 6; i++) {
    await p.page.mouse.wheel(0, 600);
    await p.page.waitForTimeout(80);
  }
  await p.page.waitForTimeout(400);
}

/** Five hours of a courier's shift: about 0.7 MB a quarter hour, a little more at lunch. */
function seed(now) {
  const pairs = [];
  for (let i = 0; i < 20; i++) {
    const slot = Math.floor((now - (20 - i) * SLOT_MS) / SLOT_MS);
    const bytes = 600_000 + (i >= 6 && i <= 10 ? 250_000 : 0) + ((i * 37_000) % 90_000);
    pairs.push(`${slot.toString(36)}:${bytes.toString(36)}`);
  }
  return pairs.join(',');
}

export default async function run(s) {
  await s.demoPost('/demo/clear?who=courier');
  const shift = await fetch(`${s.apiBase}/demo/money/shift?who=courier&hours=5`, { method: 'POST' }).then((r) => r.ok).catch(() => false);
  if (!shift) await s.demoPost('/demo/online?who=courier');
  const c = await s.signIn('0770 111 0001');
  await c.page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, seed(Date.now())]);

  await c.goto('/account');
  await c.wait('account-tab');
  await c.wait('data-use');
  await scrollTo(c, 'data-use');
  await c.shot('account-online', { settle: 900 });

  // Going off: the end of the shift says it in one line.
  await c.goto('/');
  await c.wait('online-switch');
  await c.page.waitForTimeout(1500);
  await c.slide('online-switch');
  if (!(await has(c, 'shift-summary', 6000))) await c.slide('online-switch');
  if (await has(c, 'shift-summary', 8000)) {
    await c.wait('shift-hero', 10_000);
    await scrollEnd(c);
    await c.shot('shift-summary-end', { settle: 600 });
  }

  // Off: today since midnight.
  await c.goto('/account');
  await c.wait('data-use');
  await scrollTo(c, 'data-use');
  await c.shot('account-offline', { settle: 900 });
  await c.close();
}
