// Chat on the job screen: the quick-contact row with unread badges, the customer and kitchen
// threads, a quick reply sent, the masked call.
export const name = 'partner-chat';

export default async function run(s) {
  const c = await s.signIn('0770 111 0001');
  const { orderId } = await s.demoPost('/demo/chat?who=courier&step=to_dropoff');
  await c.goto('/job');
  await c.wait('job-chat');
  await c.page.waitForTimeout(5500); // the threads poll brings the badges
  await c.shot('job-buttons', { settle: 800 });

  await c.byTestId('job-chat').click();
  await c.wait('chat-screen');
  await c.wait('chat-msg-3');
  await c.shot('customer-thread');

  await c.byTestId('qr-courier_two_min').click();
  await c.wait('chat-msg-4');
  await c.shot('customer-sent');

  await c.byTestId('chat-call').click();
  await c.page.waitForTimeout(500);
  await c.shot('call');

  await c.goto(`/chat/${orderId}?kind=merchant_courier`);
  await c.wait('chat-msg-3');
  await c.shot('kitchen-thread');
  await c.close();
}
