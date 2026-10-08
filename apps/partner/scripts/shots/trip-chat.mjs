// Step 4c, the Baghdad/Kut chat on the driver's side: «رسائل الركاب» on his evening run, سارة's question
// and her ask as a card he prices from the chat (the same sheet as «طلبات سعر»), هدى waiting under his
// price, and a private-car rider's «احجز وادفع كاش» ask he answers on its card.
export const name = 'tripchat';

export default async function run(s) {
  const seed = await s.demoPost('/demo/intercity/seed?who=intercity');
  const p = await s.signIn('0770 111 0003');

  await p.goto(`/intercity/departure/${seed.runB}`);
  await p.wait('garage-seatmap');
  await p.byTestId('trip-chats').waitFor({ timeout: 20_000 });
  await p.byTestId('trip-chats').scrollIntoViewIfNeeded();
  await p.shot('run-chats', { settle: 800 });

  await p.byTestId(`trip-chats-${seed.riders.sara}`).click();
  await p.wait('chat-screen');
  await p.page.locator('[data-testid$="-price"][data-testid^="trip-card-"]').first().waitFor({ timeout: 20_000 });
  await p.shot('driver-ask', { settle: 1000 });
  await p.page.locator('[data-testid$="-price"][data-testid^="trip-card-"]').first().click();
  await p.wait('ic-price-send');
  await p.byTestId('ic-price-2000').click();
  await p.shot('driver-sheet', { settle: 600 });
  await p.byTestId('ic-price-send').click();
  await p.byTestId('ic-price-send').waitFor({ state: 'detached', timeout: 10_000 });
  await p.byTestId('trip-deal').waitFor({ timeout: 15_000 });
  await p.page.locator('[data-testid^="trip-card-"][data-testid$="-amount"]').first().waitFor({ timeout: 15_000 });
  await p.shot('driver-sent', { settle: 1000 });

  await p.goto(`/intercity/chat/departure/${seed.runB}?with=${encodeURIComponent(seed.riders.huda)}`);
  await p.wait('chat-screen');
  await p.byTestId('trip-deal').waitFor({ timeout: 15_000 });
  await p.shot('driver-waiting', { settle: 1000 });

  await p.goto(`/intercity/chat/request/${seed.posts.cashAsk}`);
  await p.wait('chat-screen');
  await p.page.locator('[data-testid$="-yes"][data-testid^="trip-card-"]').first().waitFor({ timeout: 15_000 });
  await p.shot('driver-cash', { settle: 1000 });
  await p.page.locator('[data-testid$="-yes"][data-testid^="trip-card-"]').first().click();
  await p.byTestId('trip-deal').waitFor({ timeout: 15_000 });
  await p.shot('driver-cash-yes', { settle: 1000 });
}
