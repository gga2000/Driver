// Insights section (wave 2): مطعم خالد's last five weeks (scripts/demo/lib/khalid-history.mjs) — prep
// promised vs actual (~3 min late on average), rejections falling week on week, a lunch and a big
// night peak, best sellers and item ratings with what customers wrote (لفة كبد rates lowest).
import { khalidHistory } from './lib/khalid-history.mjs';

export default async function register(ctx) {
  const h = await khalidHistory(ctx);
  await soldOutHistory(ctx);
  ctx.route('/demo/insights/summary', () => ({ orders: h.orders.length, rejected: h.orders.filter((o) => o.state === 'merchant_rejected').length }));
}

/**
 * m4 «يخلص قبل وقته»: كص ran out on five of the last two weeks' nights around 9 at night, and باجة on
 * three mornings, as an Aziziyah grill's would; a one-off تكة doesn't make the panel.
 */
async function soldOutHistory(ctx) {
  const { EventsService } = await ctx.load('modules/events/index.js');
  const events = ctx.app.get(EventsService);
  const khalid = ctx.stores.khalid;
  const menu = await ctx.services.catalog.adminMenu(khalid.orgId);
  const idOf = (word) => menu.find((i) => i.nameAr.includes(word))?.id;
  const DAY = 86_400_000;
  const today = Date.now() - (Date.now() % DAY); // 00:00 UTC = 03:00 Baghdad
  const outs = [
    ['كص', [1, 3, 4, 7, 10], [17 * 60 + 40, 18 * 60 + 5, 18 * 60 + 20, 17 * 60 + 55, 18 * 60 + 30]], // UTC: ~9 PM Baghdad
    ['باجة', [2, 5, 9], [6 * 60 + 10, 6 * 60 + 40, 6 * 60 + 25]], // ~9:30 AM Baghdad
    ['تكة', [6], [16 * 60]],
  ];
  for (const [word, days, minutes] of outs) {
    const itemId = idOf(word);
    if (!itemId) continue;
    for (let i = 0; i < days.length; i++) {
      const at = new Date(today - days[i] * DAY + minutes[i] * 60_000);
      await events.emit(undefined, { type: 'item.sold_out', actorId: 'system:demo', occurredAt: at, payload: { merchantOrgId: khalid.orgId, itemId, until: new Date(at.getTime() + 6 * 3_600_000) } }, { name: 'org', id: khalid.orgId });
    }
  }
}
