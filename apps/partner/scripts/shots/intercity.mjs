// Wave-2 intercity shots: the garage board (both corridors/sides), announce, the boarding departure
// (seat map, PIN check-in, walk-up, no-show, late meter, blockers), the evening run with a door-pickup
// request, a request-board offer and the picked private ride.
export const name = 'intercity';

export default async function run(s) {
  const seed = await s.demoPost('/demo/intercity/seed?who=intercity');
  const p = await s.signIn('0770 111 0003');

  await p.goto('/intercity');
  await p.wait('intercity-board');
  await p.page.getByText('يريدون').first().waitFor({ timeout: 15_000 });
  await p.shot('board', { settle: 1200 });
  await p.shot('board-full', { full: true, settle: 400 });
  await p.byTestId('segment-to_aziziyah').click();
  await p.shot('board-from-baghdad', { full: true, settle: 1500 });

  // Announce, opened from the busiest demand window.
  await p.byTestId('segment-from_aziziyah').click();
  await p.page.waitForTimeout(800);
  await p.byTestId('demand-announce').first().click();
  await p.wait('intercity-announce');
  await p.shot('announce', { settle: 1500 });
  await p.shot('announce-full', { full: true, settle: 400 });

  // Run A: boarding at the garage.
  await p.goto(`/intercity/departure/${seed.runA}`);
  await p.wait('driver-seatmap');
  await p.page.getByText('زهراء').first().waitFor({ timeout: 15_000 });
  await p.shot('departure', { settle: 1500 });
  await p.shot('departure-full', { full: true, settle: 400 });

  // A walk-up on the free middle seat.
  await p.byTestId('dseat-middle_middle').click();
  await p.wait('seat-panel');
  await p.shot('walkup-panel', { settle: 600 });
  await p.byTestId('seat-panel').scrollIntoViewIfNeeded();
  await p.shot('walkup-panel-scrolled', { settle: 400 });
  await p.byTestId('dseat-middle_middle').click();

  // PIN check-in for مريم.
  const pin = seed.pins.maryam;
  await p.byTestId('pin-pad').scrollIntoViewIfNeeded();
  for (const d of pin.slice(0, 3)) await p.byTestId(`pin-key-${d}`).click();
  await p.shot('pin-typing', { settle: 300 });
  await p.byTestId(`pin-key-${pin[3]}`).click();
  await p.page.getByText('صعد مريم').first().waitFor({ timeout: 10_000 });
  await p.shot('pin-ok', { settle: 600 });

  // أحمد (cash) never came: no-show is allowed.
  await p.byTestId(`noshow-${seed.bookings.ahmed}`).scrollIntoViewIfNeeded();
  await p.byTestId(`noshow-${seed.bookings.ahmed}`).click();
  await p.page.getByText('ما إجا').first().waitFor();
  await p.shot('after-noshow', { full: true, settle: 1200 });

  // حسين checks in late → nothing blocks: انطلقنا.
  for (const d of seed.pins.hussein) await p.byTestId(`pin-key-${d}`).click();
  await p.page.getByText('صعد حسين').first().waitFor({ timeout: 10_000 });
  await p.page.waitForTimeout(1500);
  await p.shot('ready-to-go', { settle: 800 });
  await p.slide('depart');
  await p.wait('arrive');
  await p.shot('departed', { settle: 1200 });
  await p.slide('arrive');
  await p.page.getByText('وصلتوا').first().waitFor({ timeout: 10_000 });
  await p.shot('arrived', { settle: 1000 });

  // Run B: a door pickup waiting for his answer, the pickup run, a hold.
  await p.goto(`/intercity/departure/${seed.runB}`);
  await p.wait('driver-seatmap');
  await p.page.getByText('سجاد').first().waitFor({ timeout: 15_000 });
  await p.shot('evening-run', { full: true, settle: 1500 });

  // Request board: offer on the family trip to الحلة, then the stranded rider (price cap).
  await p.goto(`/intercity/request/${seed.posts.hilla}`);
  await p.wait('request-offer');
  await p.shot('request-offer', { settle: 1000 });
  await p.byTestId('offer-send').click();
  await p.page.getByText('ينتظر الراكب').first().waitFor({ timeout: 10_000 });
  await p.shot('request-offer-sent', { settle: 800 });
  await p.goto(`/intercity/request/${seed.posts.stranded}`);
  await p.wait('request-offer');
  await p.shot('request-stranded', { settle: 1000 });

  // The ride the rider picked.
  await p.goto(`/intercity/request/${seed.rideId}`);
  await p.wait('request-ride');
  await p.shot('ride', { settle: 1000 });
  await p.byTestId('ride-arrived').click();
  await p.wait('ride-complete');
  await p.shot('ride-arrived', { settle: 1000 });

  await p.goto('/intercity');
  await p.wait('intercity-board');
  await p.shot('board-after', { full: true, settle: 1500 });
  await p.close();
}
