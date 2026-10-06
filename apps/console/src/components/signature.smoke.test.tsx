import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TriageStripView } from './shell/triage-strip';

/** Phase 3 (brief D) pieces that render without the API. */
describe('the triage strip on every page (S-K1)', () => {
  it('says how many wait and how long the oldest has, with Iraqi plurals, and goes to dispatch', () => {
    const two = renderToString(<TriageStripView n={2} oldestSec={130} />);
    expect(two).toContain('طلبين يحتاجون ديسباتشر · أقدم واحد من 2:10');
    expect(two).toContain('href="/dispatch"');
    expect(two).toContain('روح للتوزيع');
    expect(renderToString(<TriageStripView n={1} oldestSec={45} />)).toContain('طلب يحتاج ديسباتشر · ينتظر من 0:45');
    expect(renderToString(<TriageStripView n={5} oldestSec={null} />)).toContain('5 طلبات تحتاج ديسباتشر');
    expect(renderToString(<TriageStripView n={12} oldestSec={61} />)).toContain('12 طلب يحتاج ديسباتشر');
  });
});
