// «الدشبول» home (partner redesign h1–h11): the map on request, the start-of-shift check, working, and
// no internet. The courier and the tuktuk driver from the demo seed.
export const name = 'dash';

const PHONES = { tuktuk: '0770 111 0002' };

export default async function run(s) {
  await s.demoPost('/demo/clear?who=tuktuk');
  const p = await s.signIn(PHONES.tuktuk);
  await p.wait('online-switch');
  await p.shot('waiting', { settle: 1500 });

  // h5: the map on request, back by itself after 20 seconds (or the button).
  if (await p.byTestId('hint-map').isVisible().catch(() => false)) {
    await p.byTestId('hint-map').click();
    await p.wait('map-peek');
    await p.shot('map-peek', { settle: 2500 });
    await p.byTestId('map-peek-back').click();
  }

  // h8: the first slide of the day opens «قبل ما تبدي».
  await p.byTestId('online-switch').click();
  await p.wait('shift-check');
  await p.shot('shift-check', { settle: 900 });
  await p.byTestId('check-go').click();
  await p.page.getByText('شغّال · ندورلك طلب').waitFor({ timeout: 15_000 });
  await p.shot('working', { settle: 2500 });

  // h3: no internet turns the top ink and says orders can't reach him.
  await p.context.setOffline(true);
  await p.page.waitForTimeout(2500);
  await p.shot('no-internet', { settle: 800 });
  await p.context.setOffline(false);
  await p.close();
}
