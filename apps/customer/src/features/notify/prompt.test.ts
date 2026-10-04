import { describe, expect, it } from 'vitest';
import { deepLinkPath, PREPROMPT_SNOOZE_MS, shouldShowPrePrompt } from './prompt';

describe('notification pre-prompt timing', () => {
  it('asks only while the OS permission is undetermined, and a "later" snoozes a week', () => {
    const now = 1_790_000_000_000;
    expect(shouldShowPrePrompt('undetermined', null, now)).toBe(true);
    expect(shouldShowPrePrompt('granted', null, now)).toBe(false);
    expect(shouldShowPrePrompt('denied', null, now)).toBe(false);
    expect(shouldShowPrePrompt('undetermined', now - 1000, now)).toBe(false);
    expect(shouldShowPrePrompt('undetermined', now - PREPROMPT_SNOOZE_MS, now)).toBe(true);
  });

  it('turns our deep links into routes and ignores anything else', () => {
    expect(deepLinkPath('driver://order/ord_1')).toBe('/order/ord_1');
    expect(deepLinkPath('driver://chat/ord_1?kind=customer_courier')).toBe('/chat/ord_1?kind=customer_courier');
    expect(deepLinkPath('driver://')).toBe('/');
    expect(deepLinkPath('https://evil.example/x')).toBeNull();
    expect(deepLinkPath(undefined)).toBeNull();
  });
});
