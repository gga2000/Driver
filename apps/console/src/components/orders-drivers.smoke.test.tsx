import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CashCapBar } from './cash-cap';
import { OrderStatus } from './order-status';
import { PeriodPicker } from './period-picker';

/** Smoke tests for the shared pieces of /orders, /orders/[id], /drivers and the driver ledger. */

const NOW = new Date('2026-10-04T19:30:00Z');

describe('orders and drivers pieces', () => {
  it('a status says the state in words with the stage icon, never colour alone', () => {
    const html = renderToString(<OrderStatus state="preparing" />);
    expect(html).toContain('<svg');
    expect(html).toMatch(/دا يتحضّر|يتحضر/);
  });

  it('the cash bar says the amount against the cap and, from amber up, the level in words', () => {
    const ok = renderToString(<CashCapBar owedIqd={600} capIqd={75_000} overCap={false} label="الكاش مقابل السقف" />);
    expect(ok).toContain('600');
    expect(ok).toContain('من 75,000');
    expect(ok).toContain('role="meter"');
    const over = renderToString(<CashCapBar owedIqd={82_000} capIqd={75_000} overCap label="الكاش مقابل السقف" />);
    expect(over).toContain('فوق السقف');
    const compact = renderToString(<CashCapBar compact owedIqd={68_000} capIqd={75_000} overCap={false} label="x" />);
    expect(compact).toContain('91%');
  });

  it('the period picker names custom days instead of showing dates', () => {
    const html = renderToString(<PeriodPicker value={{ preset: 'custom', fromDay: '2026-10-03', toDay: '2026-10-04' }} onChange={() => undefined} now={NOW} presets={['today', 'yesterday', 'week', 'custom']} />);
    expect(html).toContain('أمس');
    expect(html).toContain('آخر 7 أيام');
    expect(html).not.toMatch(/>\d{1,2}\/\d{1,2}</);
  });
});
