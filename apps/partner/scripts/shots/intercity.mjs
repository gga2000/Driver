// Wave-2 intercity shots: the garage board (both corridors/sides), announce, the boarding departure in
// garage mode (S-5: the seat map is the page — walk-up sheet, the rider's PIN sheet, the late seat with
// its meter and call, no-show, "انطلقنا" naming the blocker, التفاصيل), the evening run
// with a door-pickup request and riders' price asks (step 4), a request-board offer and the picked private ride.
export const name = 'intercity';

export default async function run(s) {
  const seed = await s.demoPost('/demo/intercity/seed?who=intercity');
  const p = await s.signIn('0770 111 0003');
  const escape = async () => {
    await p.page.keyboard.press('Escape');
    await p.page.waitForTimeout(500);
  };

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
  // «شنو سيارتك؟»: the listed models for this seat layout (the rider sees this car under the seats).
  await p.byTestId('announce-model').scrollIntoViewIfNeeded();
  await p.shot('announce-car', { settle: 600 });

  // Run A: boarding at the garage — garage mode.
  await p.goto(`/intercity/departure/${seed.runA}`);
  await p.wait('garage-seatmap');
  await p.page.getByText('زهراء').first().waitFor({ timeout: 15_000 });
  await p.shot('departure', { settle: 1500 });
  await p.shot('departure-full', { full: true, settle: 400 });

  // A walk-up on the free middle seat: the sheet with the server's cash amount.
  await p.byTestId('gseat-middle_middle').click();
  await p.wait('walkup-cash');
  await p.shot('walkup-panel', { settle: 600 });
  await escape();

  // مريم's seat → her PIN sheet (another rider's PIN here is refused: "هذا مو رمز مريم"; not shot,
  // the refused request would count as a console error).
  await p.byTestId('gseat-rear_left').click();
  await p.wait('rider-sheet');
  const pin = seed.pins.maryam;
  for (const d of pin.slice(0, 3)) await p.byTestId(`pin-key-${d}`).click();
  await p.shot('pin-typing', { settle: 300 });
  await p.byTestId(`pin-key-${pin[3]}`).click();
  await p.page.getByText('صعد مريم').first().waitFor({ timeout: 10_000 });
  await p.page.waitForTimeout(1200);
  await p.shot('pin-ok', { settle: 600 });

  // حسين is late: red seat with the meter; his sheet has the call.
  await p.byTestId('gseat-middle_left').click();
  await p.wait('rider-late');
  await p.shot('late-seat', { settle: 600 });
  await p.byTestId('rider-call').click();
  await p.page.waitForTimeout(1200);
  await p.shot('late-call', { settle: 300 });

  // أحمد (cash) never came: no-show from his sheet.
  await p.byTestId('gseat-rear_right').click();
  await p.wait('sheet-noshow');
  await p.byTestId('sheet-noshow').click();
  await p.page.getByText('ما إجا').first().waitFor();
  await p.page.waitForTimeout(800);
  await p.shot('after-noshow', { settle: 1200 });

  // التفاصيل: riders, money and the run.
  await p.byTestId('segment-details').click();
  await p.page.waitForTimeout(600);
  await p.shot('details', { full: true, settle: 800 });
  await p.byTestId('segment-seats').click();

  // حسين checks in late through «دخّل رمز صعود» (f1): four boxes, his name and seat in green, then done.
  await p.byTestId('code-open').click();
  await p.wait('code-sheet');
  await p.shot('code-sheet', { settle: 600 });
  for (const d of seed.pins.hussein) await p.byTestId(`pin-key-${d}`).click();
  await p.wait('code-ok');
  await p.shot('code-ok', { settle: 600 });
  await p.byTestId('code-next').click();
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
  await p.wait('garage-seatmap');
  await p.page.getByText('سجاد').first().waitFor({ timeout: 15_000 });
  await p.shot('evening-run', { settle: 1500 });
  await p.shot('evening-run-full', { full: true, settle: 400 });
  // His painted car: سجاد's seat (a door pickup waiting for his answer) opens his sheet.
  await p.byTestId('gseat-back_left').click();
  await p.wait('rider-sheet');
  await p.shot('evening-run-sheet', { settle: 600 });
  await escape();
  await p.byTestId('segment-details').click();
  await p.page.waitForTimeout(600);
  await p.shot('evening-run-details', { full: true, settle: 800 });

  // Step 4 agreed prices: «طلبات سعر» on the run — سارة waits for his price, هدى for her answer, نور agreed.
  await p.byTestId('ic-price-asks').scrollIntoViewIfNeeded();
  await p.shot('price-asks', { settle: 800 });
  await p.page.locator('[data-testid^="ask-price-"]').first().click();
  await p.wait('ic-price-send');
  await p.byTestId('ic-price-2000').click();
  await p.byTestId('ic-price-more').click();
  await p.shot('price-sheet', { settle: 600 });
  await p.byTestId('ic-price-send').click();
  await p.byTestId('ic-price-send').waitFor({ state: 'detached', timeout: 10_000 });
  await p.page.locator('[data-testid^="ask-price-"]').first().waitFor({ state: 'detached', timeout: 10_000 });
  await p.shot('price-asks-sent', { settle: 800 });

  // Request board: offer on the family trip to الحلة, then the stranded rider (price cap).
  await p.goto(`/intercity/request/${seed.posts.hilla}`);
  await p.wait('request-offer');
  await p.shot('request-offer', { settle: 1000 });
  await p.byTestId('offer-send').click();
  await p.page.getByText('ينتظر الراكب').first().waitFor({ timeout: 10_000 });
  await p.shot('request-offer-sent', { settle: 800 });
  // w1/p2: a «يستناك وترجع» trip to Najaf: the usual range under the price, and his waiting terms.
  await p.goto(`/intercity/request/${seed.posts.najaf}`);
  await p.wait('offer-wait');
  await p.shot('request-offer-wait', { full: true, settle: 1000 });
  await p.byTestId('offer-wait').locator('[aria-label="+1,000"]').click();
  await p.byTestId('offer-wait').locator('[aria-label="+1,000"]').click();
  await p.byTestId('offer-wait').locator('[aria-label="+1,000"]').click();
  await p.shot('request-offer-wait-set', { full: true, settle: 600 });
  await p.goto(`/intercity/request/${seed.posts.stranded}`);
  await p.wait('request-offer');
  await p.shot('request-stranded', { settle: 1000 });
  // Step 4b a6: a rider asks to book and pay cash (no deposit); he says yes; the ride he booked that way.
  await p.goto(`/intercity/request/${seed.posts.cashAsk}`);
  await p.wait('offer-cash-ask');
  await p.shot('request-cash-ask', { settle: 1000 });
  await p.byTestId('offer-cash-yes').click();
  await p.wait('offer-cash-accepted');
  await p.shot('request-cash-accepted', { settle: 800 });
  await p.goto(`/intercity/request/${seed.cashRide}`);
  await p.wait('ride-money');
  await p.shot('ride-cash', { full: true, settle: 1000 });

  // The ride the rider picked.
  await p.goto(`/intercity/request/${seed.rideId}`);
  await p.wait('request-ride');
  await p.shot('ride', { settle: 1000 });
  await p.byTestId('ride-arrived').click();
  await p.wait('ride-complete');
  await p.shot('ride-arrived', { settle: 1000 });

  // w2/w3: a «يستناك وترجع» ride: the start button once he drops the rider, then the live clock 10
  // minutes before the included hours end, with «رجع الراكب · وقّف العداد».
  await p.goto(`/intercity/request/${seed.waitRides.ready}`);
  await p.wait('ride-wait-start');
  await p.shot('ride-wait-start', { settle: 1000 });
  await p.goto(`/intercity/request/${seed.waitRides.waiting}`);
  await p.wait('ride-wait-clock');
  await p.wait('ride-wait-end');
  await p.shot('ride-waiting', { full: true, settle: 1000 });
  // k2 «جيب واحد»: who he fetches, that the person at the pickup isn't the one who booked, and the call.
  await p.goto(`/intercity/request/${seed.fetchRide}`);
  await p.wait('ride-fetch-for');
  await p.shot('ride-fetch', { full: true, settle: 1000 });

  await p.goto('/intercity');
  await p.wait('intercity-board');
  await p.shot('board-after', { full: true, settle: 1500 });
  await p.close();
}
