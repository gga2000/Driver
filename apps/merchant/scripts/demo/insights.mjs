// Insights section (wave 2): مطعم خالد's last five weeks (scripts/demo/lib/khalid-history.mjs) — prep
// promised vs actual (~3 min late on average), rejections falling week on week, a lunch and a big
// night peak, best sellers and item ratings with what customers wrote (لفة كبد rates lowest).
import { khalidHistory } from './lib/khalid-history.mjs';

export default async function register(ctx) {
  const h = await khalidHistory(ctx);
  ctx.route('/demo/insights/summary', () => ({ orders: h.orders.length, rejected: h.orders.filter((o) => o.state === 'merchant_rejected').length }));
}
