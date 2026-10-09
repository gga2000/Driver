// "الخردة علينا" (Phase 3, partner S-2): the job card with the customer's stated note, the cash
// helper at the door (chips, change to hand back, "ما عندي خردة · حطها رصيد بمحفظته"), and the done
// screen with the cash bar moving from the old to the new amount on hand.
export const name = 'cash';

const COURIER = '0770 111 0001';

export default async function run(s) {
  const c = await s.signIn(COURIER);

  // The customer said "راح أدفع بـ 25,000": the job card tells him which change to bring.
  await s.demoPost('/demo/job?who=courier&step=to_dropoff&tender=25000');
  await c.goto('/job');
  await c.wait('job-action');
  await c.shot('job-card', { settle: 1500 });

  await s.demoPost('/demo/job?who=courier&step=at_dropoff&tender=25000');
  await c.goto('/job');
  await c.wait('job-action');
  await c.byTestId('job-action').click();
  await c.wait('handover-panel');
  await c.shot('door', { settle: 900 });
  await c.shot('door-full', { full: true, settle: 300 });

  // He picks the customer's note: "رجّعله 7,250 دينار".
  const tender = c.byTestId('tender-chip-25000');
  if (await tender.count()) {
    await tender.click();
    await c.shot('door-tendered', { full: true, settle: 500 });
    // No change on him: the full note is his, the rest goes to the customer's wallet.
    const nochange = c.byTestId('door-no-change');
    if (await nochange.count()) {
      await nochange.click();
      await c.shot('door-no-change', { full: true, settle: 500 });
    }
    // A 50,000 note: 36,000 back is more than the wallet takes — he hands it back in cash.
    await c.byTestId('tender-chip-50000').click();
    await c.shot('door-over-cap', { full: true, settle: 500 });
    // "غير": another amount on the number pad (30,000).
    await c.byTestId('tender-chip-other').click();
    await c.wait('tender-pad');
    for (const k of ['3', '0', '000']) await c.byTestId(`tender-pad-keys-${k}`).click();
    await c.shot('door-other', { full: true, settle: 500 });
    await c.byTestId('tender-pad-close').click();
    await c.byTestId('tender-chip-25000').click();
    await c.byTestId('door-no-change').click();
  }
  await c.shot('door-ready', { settle: 500 });
  await c.slide('handover-confirm');
  await c.wait('job-done');
  await c.shot('done', { settle: 1600 }); // the earned line counts up over 1.1 s
  await c.shot('done-settled', { settle: 1600 });

  await s.demoPost('/demo/clear?who=courier');
  await c.close();
}
