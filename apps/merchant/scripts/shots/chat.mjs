// Chat shots: the order detail's contact row (unread badges, masked call), the courier thread with a
// quick reply sent, and the customer's question about the order. Seeded by scripts/demo/chat.mjs.
export default {
  name: 'merchant-chat',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, goto } = h;
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    const fresh = await demoPost('/demo/chat/fresh');
    if (!fresh) return;
    if (h.viewport === 'phone') {
      await byTestId('segment-preparing').click();
    }
    const card = byTestId(`order-${fresh.number}`);
    await card.waitFor({ timeout: 15_000 });
    await card.locator('[role="button"]').first().click();
    await byTestId('detail-contact').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(5500); // the threads poll brings the badges
    await shot('detail');

    await byTestId('detail-chat-courier').click();
    await byTestId('chat-screen').waitFor({ timeout: 15_000 });
    await byTestId('chat-msg-2').waitFor({ timeout: 15_000 });
    await shot('courier-thread');

    await byTestId('qr-merchant_delay_5').click();
    await byTestId('chat-msg-3').waitFor({ timeout: 15_000 });
    await shot('courier-sent');

    await goto(`/chat/${fresh.orderId}?kind=customer_merchant`);
    await byTestId('chat-msg-2').waitFor({ timeout: 15_000 });
    await shot('customer-thread');
    await goto('/');
  },
};
