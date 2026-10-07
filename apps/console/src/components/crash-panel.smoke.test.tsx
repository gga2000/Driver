import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { crashReporter } from '@/lib/crash';
import { CrashPanel } from './crash-panel';

describe('the Console crash page (error.tsx / global-error.tsx)', () => {
  it('says the page broke, nothing was lost, with a retry and a reload', () => {
    const html = renderToString(<CrashPanel error={new Error('x')} reset={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('صار خلل بهالصفحة');
    expect(html).toContain('جرّب مرة ثانية');
    expect(html).toContain('عيد فتح الصفحة');
  });

  it('sends nothing without NEXT_PUBLIC_SENTRY_DSN', () => {
    expect(crashReporter.enabled).toBe(false);
  });
});
