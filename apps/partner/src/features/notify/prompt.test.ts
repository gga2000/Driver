import { describe, expect, it } from 'vitest';
import { deepLinkPath, PREPROMPT_SNOOZE_MS, shouldShowPrePrompt } from './prompt';

describe('partner notification pre-prompt', () => {
  it('asks while undetermined; "later" waits a day', () => {
    const now = 1_790_000_000_000;
    expect(shouldShowPrePrompt('undetermined', null, now)).toBe(true);
    expect(shouldShowPrePrompt('denied', null, now)).toBe(false);
    expect(shouldShowPrePrompt('undetermined', now - PREPROMPT_SNOOZE_MS + 1, now)).toBe(false);
    expect(shouldShowPrePrompt('undetermined', now - PREPROMPT_SNOOZE_MS, now)).toBe(true);
  });

  it('opens only partner deep links', () => {
    expect(deepLinkPath('driver-partner://offer')).toBe('/offer');
    expect(deepLinkPath('driver://order/1')).toBeNull();
  });
});
