import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TriageStripView } from './shell/triage-strip';
import { LiveDownStripView } from './shell/watch-strip';

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

describe('the live-updates-down strip (E1 step 3)', () => {
  it('says how long, and whether the person on call was told', () => {
    const mine = renderToString(<LiveDownStripView minutes={2} told={false} />);
    expect(mine).toContain('التحديث المباشر واقف من دقيقتين');
    expect(mine).toContain('الشاشة تتحدث كل كم ثانية بس');
    expect(renderToString(<LiveDownStripView minutes={3} told />)).toContain('والمناوب انبلغ');
  });
});
