// «عندي اعتراض» answered (partner audit S-7 follow-up): support's reply and resolution reach the receipt.
//
//   POST /demo/pay-query?who=courier&step=open      objects to his latest job (the receipt: «دا نراجعه»)
//   POST /demo/pay-query?who=courier&step=reply     support replies (push + «ردّ الدعم: …» on the receipt)
//   POST /demo/pay-query?who=courier&step=resolve   support settles it («انحلت» + the outcome)
//
// Each step does the ones before it when they are missing. Answers { key, at, ticketId, path } — `path`
// opens that receipt in the app (the same link the push carries).
export default async function register(demo) {
  const { DriverAccountService } = await demo.load('modules/driver-account/index.js');
  const { SupportService } = await demo.load('modules/support/index.js');
  const account = demo.app.get(DriverAccountService);
  const support = demo.app.get(SupportService);
  const agent = { personId: 'demo-support', sessionId: 'demo' };

  demo.route('/demo/pay-query', async ({ res, query }) => {
    const { personId } = demo.who(query);
    const me = { personId, sessionId: 'demo' };
    const step = query.step ?? 'reply';
    const jobs = (await account.earnings(me, { period: 'week' })).jobs.sort((a, b) => b.at.getTime() - a.at.getTime());
    const job = jobs[0];
    if (!job) return demo.json(res, 404, { error: 'no jobs this week' });
    const q = await account.payQuery(me, { key: job.key, at: job.at, message: 'اعتراض على الأجرة: العمولة أكثر من المتفق عليه' });
    let r = await account.jobReceipt(me, { key: job.key, at: job.at });
    if ((step === 'reply' || step === 'resolve') && !r.query?.reply && r.query?.status === 'open') {
      await support.reply(agent, { ticketId: q.ticketId, text: 'هلا بيك، العمولة 12% على الطلب. نراجع الحساب ونرد عليك اليوم', internal: false });
    }
    if (step === 'resolve' && r.query?.status !== 'resolved') {
      await support.resolve(agent, { ticketId: q.ticketId, resolution: 'راجعنا الحساب: الأجرة صحيحة والعمولة 12% مثل المتفق عليه' });
    }
    r = await account.jobReceipt(me, { key: job.key, at: job.at });
    const path = `/earnings/receipt?key=${encodeURIComponent(job.key)}&at=${encodeURIComponent(job.at.toISOString())}`;
    demo.json(res, 200, { key: job.key, at: job.at, ticketId: q.ticketId, query: r.query, path });
  });
}
