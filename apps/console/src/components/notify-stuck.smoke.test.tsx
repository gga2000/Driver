import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NotifyStuckView } from './system-page';

describe('System page: stuck outgoing messages', () => {
  it('none stuck: zero and the all-clear line', () => {
    const html = renderToString(<NotifyStuckView stuck={0} oldestSec={0} />);
    expect(html).toContain('ماكو رسالة عالگة');
    expect(html).not.toContain('text-bad');
  });

  it('some stuck: the count in red, the oldest in minutes, and why nothing is resent', () => {
    const html = renderToString(<NotifyStuckView stuck={3} oldestSec={7 * 60 + 30} />);
    expect(html).toContain('علگت');
    expect(html).toMatch(/text-bad[^>]*>3</);
    expect(html).toMatch(/>7</);
    expect(html).toContain('ما نعيد إرسالها حتى ما توصل مرتين');
  });
});
