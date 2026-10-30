// Way C (Ali 2026-10-09): the driver's riders list on a shared private car. زهراء booked it (two
// places, cash), مريم said «صعدت» on her phone, نور hasn't: he confirms her himself.
export const name = 'shareboard';

export default async function run(s) {
  const seed = await s.demoPost('/demo/intercity/seed?who=intercity');
  const p = await s.signIn('0770 111 0003');
  await p.goto(`/intercity/request/${seed.sharedRide}`);
  await p.wait('ride-share-riders');
  await p.byTestId('ride-share-riders').scrollIntoViewIfNeeded();
  await p.shot('riders', { settle: 800 });
  await p.page.locator('[data-testid^="ride-share-board-"]').first().click();
  await p.byTestId('ride-share-count').waitFor({ timeout: 15_000 });
  await p.page.locator('[data-testid^="ride-share-board-"]').first().waitFor({ state: 'detached', timeout: 15_000 });
  await p.byTestId('ride-share-riders').scrollIntoViewIfNeeded();
  await p.shot('riders-all-in', { settle: 800 });
}
