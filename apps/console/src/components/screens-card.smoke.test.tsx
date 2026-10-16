import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ScreenSwitchView } from '@driver/contracts';
import { ScreensList } from './screens-card';

const AT = new Date('2026-10-08T15:00:00Z');
const row = (key: ScreenSwitchView['key'], audience: ScreenSwitchView['audience'], reason: string | null = null): ScreenSwitchView => ({
  cityId: 'aziziyah',
  key,
  audience,
  reason,
  setBy: reason ? 'p_ali' : null,
  setByName: reason ? 'علي' : null,
  setAt: reason ? AT : null,
});
const ROWS = [row('basket_v2', 'staff', 'نجرّبها بموبايلاتنا'), row('checkout_v2', 'off'), row('track_v2', 'all', 'جرّبناها أسبوع'), row('orders_v2', 'off')];

describe('screen switches card', () => {
  it('an admin gets the three-way choice on every screen', () => {
    const html = renderToString(<ScreensList rows={ROWS} canShow canOff onChange={() => undefined} />);
    expect(html.match(/role="radiogroup"/g)).toHaveLength(4);
    expect(html).toContain('السلة');
    expect(html).toContain('نجرّبها بموبايلاتنا');
  });
  it('a dispatcher only gets «back to the old screen», and only where a new screen is showing', () => {
    const html = renderToString(<ScreensList rows={ROWS} canShow={false} canOff onChange={() => undefined} />);
    expect(html).not.toContain('role="radiogroup"');
    expect(html).toContain('screen-off-basket_v2');
    expect(html).toContain('screen-off-track_v2');
    expect(html).not.toContain('screen-off-checkout_v2');
  });
  it('support sees the states with no buttons', () => {
    const html = renderToString(<ScreensList rows={ROWS} canShow={false} canOff={false} onChange={() => undefined} />);
    expect(html).not.toContain('<button');
  });
});
