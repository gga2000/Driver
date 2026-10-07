// Taxi/tuktuk step 3 (docs/api/ride-safety.md): a night ride's pickup asks for the rider's trip code
// (the job's note, the pad, a wrong code refused, the right one starting the ride), and home's strip
// when a rider reopened a finished ride's chat to find something he left in the car.
export const name = 'ride-safety';

const TUKTUK = '0770 111 0002';

export default async function run(s) {
  const tk = await s.signIn(TUKTUK);
  const { startCode } = await s.demoPost('/demo/ride-safety?who=tuktuk&step=at_pickup');
  await tk.goto('/job');
  await tk.wait('job-start-code-needed');
  await tk.shot('job', { settle: 1500 });

  await tk.slide('job-action');
  await tk.wait('start-code-panel');
  await tk.shot('pad');

  // A wrong code first (the last digit off by one): refused, the pad clears.
  const wrong = `${startCode.slice(0, 3)}${(Number(startCode[3]) + 1) % 10}`;
  for (const d of wrong) await tk.byTestId(`start-code-key-${d}`).click();
  tk.expectRefusal();
  await tk.byTestId('start-code-submit').click();
  await tk.wait('start-code-wrong');
  await tk.shot('wrong');
  tk.expectRefusal(false);

  for (const d of startCode) await tk.byTestId(`start-code-key-${d}`).click();
  await tk.shot('typed');
  await tk.byTestId('start-code-submit').click();
  await tk.page.locator('[data-testid="start-code-panel"]').waitFor({ state: 'detached', timeout: 15_000 });
  await tk.shot('started', { settle: 1500 });

  await s.demoPost('/demo/ride-safety?who=tuktuk&step=lost_item');
  await tk.goto('/');
  await tk.page.locator('[data-testid^="lost-item-"]').first().waitFor({ timeout: 20_000 });
  await tk.shot('home-lost-item', { settle: 1500 });
  await tk.close();
}
