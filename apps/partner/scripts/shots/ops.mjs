// Wave-2 Ops mode shots: home with tasks, the cash hand-over (courier → amount + code → receipt;
// a wrong code is not shot: the 400 it returns would count as a console error),
// a landmark photo, and the merchant onboarding wizard step by step.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'ops';

const OPS = '0770 111 0006';

/** Sample "camera" photos rendered in the browser (a menu page and a street scene), flat in date brown and saffron (check-up item 5). */
async function samplePhotos(s) {
  const dir = join(s.outDir, '.fixtures');
  mkdirSync(dir, { recursive: true });
  const p = await s.openPage();
  const menu = (title, rows, hue) => `<!doctype html><html dir="rtl"><body style="margin:0;width:600px;height:800px;background:hsl(${hue},45%,92%);font-family:'IBM Plex Sans Arabic',sans-serif;display:flex;flex-direction:column;align-items:center;padding:40px;box-sizing:border-box">
    <div style="font-size:54px;font-weight:700;color:hsl(${hue},55%,28%)">${title}</div><div style="width:70%;border-top:3px solid hsl(${hue},40%,40%);margin:18px 0 28px"></div>
    ${rows.map(([n, pr]) => `<div style="width:100%;display:flex;justify-content:space-between;font-size:30px;color:#2b2118;padding:10px 0;border-bottom:1px dotted #a58f75"><span>${n}</span><span>${pr}</span></div>`).join('')}</body></html>`;
  const pages = [
    menu('فرن الأمير', [['صمون حجري', '250'], ['خبز تنور', '250'], ['لحم بعجين', '1,000'], ['فطيرة جبن', '1,500'], ['بيتزا صغيرة', '3,000'], ['كاهي وقيمر', '2,000']], 30),
    menu('المشروبات', [['شاي', '250'], ['حليب', '750'], ['عصير برتقال', '1,500'], ['لبن', '500']], 40),
    menu('الحلويات', [['كليچة تمر', '1,000'], ['زلابية', '1,500'], ['بقلاوة', '2,500']], 20),
  ];
  const files = [];
  for (const [i, html] of pages.entries()) {
    await p.page.setViewportSize({ width: 600, height: 800 });
    await p.page.setContent(html);
    const f = join(dir, `menu-${i + 1}.jpg`);
    await p.page.screenshot({ path: f, type: 'jpeg', quality: 80 });
    files.push(f);
  }
  await p.page.setViewportSize({ width: 800, height: 600 });
  await p.page.setContent(`<!doctype html><body style="margin:0;width:800px;height:600px;background:linear-gradient(#F6D9A8,#FFF6E6 60%);position:relative;overflow:hidden">
    <div style="position:absolute;left:260px;top:120px;width:280px;height:280px;border-radius:50%;background:#6B4426"></div>
    <div style="position:absolute;left:220px;top:250px;width:360px;height:260px;background:#F1DFC2"></div>
    <div style="position:absolute;left:140px;top:90px;width:34px;height:420px;background:#E3C9A0"></div><div style="position:absolute;left:131px;top:70px;width:52px;height:40px;border-radius:26px 26px 0 0;background:#6B4426"></div>
    <div style="position:absolute;left:626px;top:90px;width:34px;height:420px;background:#E3C9A0"></div><div style="position:absolute;left:617px;top:70px;width:52px;height:40px;border-radius:26px 26px 0 0;background:#6B4426"></div>
    <div style="position:absolute;left:360px;top:380px;width:80px;height:130px;border-radius:40px 40px 0 0;background:#3A2414"></div>
    <div style="position:absolute;left:0;top:500px;width:800px;height:100px;background:#8a8378"></div>
    <div style="position:absolute;left:0;top:545px;width:800px;height:6px;background:repeating-linear-gradient(90deg,#f4efe4 0 40px,transparent 40px 80px)"></div></body>`);
  const street = join(dir, 'landmark.jpg');
  await p.page.screenshot({ path: street, type: 'jpeg', quality: 80 });
  // f8: a bakery's door with its sign, and the pharmacy next door couriers know.
  await p.page.setContent(`<body style="margin:0;width:800px;height:600px;position:relative;background:linear-gradient(#F6D9A8,#FFF6E6 55%)">
    <div style="position:absolute;left:40px;top:120px;width:470px;height:400px;background:#e8dcc6"></div>
    <div style="position:absolute;left:60px;top:140px;width:430px;height:80px;background:#7a3e12;color:#fbe7c6;font:700 52px 'IBM Plex Sans Arabic',sans-serif;display:flex;align-items:center;justify-content:center" dir="rtl">فرن الأمير</div>
    <div style="position:absolute;left:150px;top:260px;width:250px;height:260px;background:#5b4a3a;border:10px solid #3f3227"></div>
    <div style="position:absolute;left:540px;top:170px;width:230px;height:350px;background:#f3f1ea"></div>
    <div style="position:absolute;left:555px;top:185px;width:200px;height:70px;background:#1f7a4a;color:#fff;font:700 38px 'IBM Plex Sans Arabic',sans-serif;display:flex;align-items:center;justify-content:center" dir="rtl">صيدلية</div>
    <div style="position:absolute;left:630px;top:290px;width:50px;height:50px;background:#1f7a4a;clip-path:polygon(35% 0,65% 0,65% 35%,100% 35%,100% 65%,65% 65%,65% 100%,35% 100%,35% 65%,0 65%,0 35%,35% 35%)"></div>
    <div style="position:absolute;left:0;top:520px;width:800px;height:80px;background:#8a8378"></div></body>`);
  const door = join(dir, 'door.jpg');
  await p.page.screenshot({ path: door, type: 'jpeg', quality: 80 });
  await p.close();
  return { menus: files, street, door };
}

/** Clicks `testId`, which opens the browser's file chooser, and hands it `files`. */
async function choose(p, testId, files) {
  const [chooser] = await Promise.all([p.page.waitForEvent('filechooser'), p.byTestId(testId).click()]);
  await chooser.setFiles(files);
}

export default async function run(s) {
  const photos = await samplePhotos(s);
  const couriers = await (await fetch(`${s.apiBase}/demo/ops/couriers`)).json();
  const p = await s.signIn(OPS);

  await p.goto('/ops');
  await p.wait('ops-tasks');
  await p.shot('home', { full: true, settle: 1200 });
  // f5: the network drops in the street: the list stays, and says from when.
  await p.page.context().setOffline(true);
  await p.wait('ops-stale', 8000);
  await p.page.locator('[data-testid="ops-stale"]').scrollIntoViewIfNeeded();
  await p.shot('home-offline', { settle: 800 });
  await p.page.context().setOffline(false);
  await p.page.waitForTimeout(1500);

  // Cash: pick the over-cap courier, full amount, his code, confirm → receipt.
  await p.byTestId('ops-go-cash').click();
  await p.wait(`ops-courier-${couriers.c_murtadha}`);
  await p.shot('cash-couriers', { full: true, settle: 900 });
  await p.byTestId(`ops-courier-${couriers.c_murtadha}`).click();
  await p.wait('ops-code-pad');
  await p.shot('cash-amount', { settle: 500 });
  const { code } = await (await fetch(`${s.apiBase}/demo/ops/code?who=c_murtadha`)).json();
  for (const d of code) await p.byTestId(`ops-pad-${d}`).click();
  await p.shot('cash-code', { settle: 500 });
  await p.byTestId('ops-cash-confirm').click();
  await p.wait('ops-receipt-done');
  await p.shot('cash-receipt', { full: true, settle: 900 });

  // Landmark photo.
  await p.goto('/ops/landmark');
  await p.wait('ops-landmark');
  await p.page.locator('[data-testid^="ops-landmark-pl_"]').first().waitFor();
  await p.shot('landmark', { full: true, settle: 900 });
  const target = p.page.locator('[data-testid^="ops-landmark-pl_"]').first();
  await target.click();
  await choose(p, 'ops-landmark-camera', photos.street);
  await p.wait('ops-landmark-preview');
  await p.page.locator('[data-testid="ops-landmark-name-input"]').fill('يم مستشفى العزيزية');
  await p.page.locator('[data-testid="ops-landmark-name-input"]').press('Enter');
  await p.shot('landmark-ready', { full: true, settle: 900 });
  await p.byTestId('ops-landmark-submit').click();
  await p.wait('ops-landmark-sent');
  await p.shot('landmark-sent', { settle: 700 });

  // Merchant onboarding wizard.
  await p.context.grantPermissions(['geolocation']);
  await p.context.setGeolocation({ latitude: 32.8964, longitude: 45.0679, accuracy: 8 });
  await p.goto('/ops/onboard');
  await p.wait('ops-onboard-shop');
  await p.page.locator('[data-testid="ops-onboard-name"]').fill('فرن الأمير');
  await p.shot('onboard-shop', { settle: 500 });
  await p.byTestId('ops-onboard-next').click();
  await p.wait('ops-onboard-contact');
  await p.page.locator('[data-testid="ops-onboard-contact-name"]').fill('أبو أمير');
  await p.page.locator('[data-testid="ops-onboard-contact-phone"]').fill('07812345678');
  await p.shot('onboard-contact', { settle: 500 });
  await p.byTestId('ops-onboard-next').click();
  await p.wait('ops-onboard-location');
  await p.byTestId('ops-onboard-here').click();
  await p.page.getByText('الدبوس على موقعك').waitFor({ timeout: 10_000 });
  await p.shot('onboard-location', { settle: 1800 });
  // f8: the door photo. The first send drops (a street with a weak network), then one tap sends it.
  await p.page.locator('[data-testid="ops-onboard-door"]').scrollIntoViewIfNeeded();
  p.expectRefusal();
  await p.page.route('**/*', (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 400, body: '' }) : route.continue()));
  await choose(p, 'ops-onboard-door-add', photos.door);
  await p.wait('ops-onboard-door-failed');
  await p.page.unroute('**/*');
  p.expectRefusal(false);
  await p.page.locator('[data-testid="ops-onboard-door"]').scrollIntoViewIfNeeded();
  await p.shot('onboard-door-failed', { settle: 500 });
  await p.byTestId('ops-onboard-door-retry').click();
  await p.wait('ops-onboard-door-sent');
  await p.page.locator('[data-testid="ops-onboard-door"]').scrollIntoViewIfNeeded();
  await p.shot('onboard-door-sent', { settle: 500 });
  await p.byTestId('ops-onboard-next').click();
  await p.wait('ops-onboard-menu');
  // f8: the last menu page doesn't send; it stays, marked, and one tap sends it again.
  p.expectRefusal();
  let puts = 0;
  await p.page.route('**/*', (route) => (route.request().method() === 'PUT' && ++puts === 3 ? route.fulfill({ status: 400, body: '' }) : route.continue()));
  await choose(p, 'ops-onboard-add-photo', photos.menus);
  await p.wait('ops-onboard-photos-failed');
  await p.page.unroute('**/*');
  p.expectRefusal(false);
  await p.page.waitForTimeout(800);
  await p.shot('onboard-menu-failed', { settle: 600 });
  await p.byTestId('ops-onboard-photo-retry-2').click();
  await p.page.locator('[data-testid="ops-onboard-photos-failed"]').waitFor({ state: 'detached', timeout: 10_000 });
  await p.page.waitForFunction(() => document.querySelectorAll('[role="progressbar"]').length === 0, null, { timeout: 15_000 }).catch(() => undefined);
  await p.page.waitForTimeout(1200);
  await p.shot('onboard-menu', { settle: 600 });
  await p.byTestId('ops-onboard-next').click();
  await p.wait('ops-onboard-settle');
  await p.byTestId('ops-onboard-settle-daily_zaincash').click();
  await p.shot('onboard-settle', { full: true, settle: 500 });
  await p.byTestId('ops-onboard-next').click();
  await p.wait('ops-onboard-review');
  await p.shot('onboard-review', { settle: 600 });
  await p.byTestId('ops-onboard-next').click();
  await p.wait('ops-onboard-done');
  await p.shot('onboard-done', { settle: 600 });
  await p.close();
}
