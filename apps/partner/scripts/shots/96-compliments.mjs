// «كلام الزبائن» (joy l4): the kind words customers picked for the courier after a 4–5 rating — the
// screen (counts and the latest), the account hub row, and «قالوا عنك بهالشفت» on the shift summary.
// Seeded by scripts/demo/97-compliments.mjs.
export const name = 'compliments';

const COURIER = '0770 111 0001';

export default async function run(s) {
  const c = await s.signIn(COURIER);
  await c.goto('/compliments');
  await c.wait('compliments-summary', 15_000);
  await c.shot('screen', { settle: 1200 });

  await c.goto('/account');
  await c.wait('hub-compliments', 15_000);
  await c.byTestId('hub-compliments').scrollIntoViewIfNeeded();
  await c.shot('hub-row', { settle: 600 });

  // The shift that started four hours ago: three customers said something during it.
  const from = new Date(Date.now() - 4 * 3_600_000).toISOString();
  await c.goto(`/shift?from=${encodeURIComponent(from)}`);
  await c.wait('shift-hero', 15_000);
  await c.wait('shift-compliments', 10_000);
  await c.byTestId('shift-compliments').scrollIntoViewIfNeeded();
  await c.shot('shift', { settle: 1200 });
}
