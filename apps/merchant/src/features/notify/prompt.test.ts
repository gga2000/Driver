import { describe, expect, it } from 'vitest';
import { deepLinkPath, PREPROMPT_SNOOZE_MS, shouldShowPrePrompt } from './prompt';

describe('merchant notification pre-prompt', () => {
  it('asks while undetermined; "later" waits a day', () => {
    const now = 1_790_000_000_000;
    expect(shouldShowPrePrompt('undetermined', null, now)).toBe(true);
    expect(shouldShowPrePrompt('granted', null, now)).toBe(false);
    expect(shouldShowPrePrompt('undetermined', now - PREPROMPT_SNOOZE_MS, now)).toBe(true);
  });

  it('opens the board for a new order and the money screen for a cash receipt', () => {
    expect(deepLinkPath('driver-merchant://order/ord_1')).toBe('/');
    expect(deepLinkPath('driver-merchant://money')).toBe('/money');
    expect(deepLinkPath('driver://order/ord_1')).toBeNull();
  });
});
