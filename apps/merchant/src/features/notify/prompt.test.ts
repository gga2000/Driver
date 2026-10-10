import { describe, expect, it } from 'vitest';
import { boardCalmForPrompt, deepLinkPath, PREPROMPT_SNOOZE_MS, pushHealthOf, shouldShowPrePrompt } from './prompt';

const DAY = 86_400_000;

describe('merchant notification pre-prompt', () => {
  it('asks while undetermined; "later" waits a week, not a day (M-03)', () => {
    const now = 1_790_000_000_000;
    expect(shouldShowPrePrompt('undetermined', null, now)).toBe(true);
    expect(shouldShowPrePrompt('granted', null, now)).toBe(false);
    expect(shouldShowPrePrompt('denied', null, now)).toBe(false);
    expect(PREPROMPT_SNOOZE_MS).toBe(7 * DAY);
    expect(shouldShowPrePrompt('undetermined', now - DAY, now)).toBe(false);
    expect(shouldShowPrePrompt('undetermined', now - 6 * DAY, now)).toBe(false);
    expect(shouldShowPrePrompt('undetermined', now - PREPROMPT_SNOOZE_MS, now)).toBe(true);
  });

  it('never shows while an order rings, a sheet is open or before the shift starts', () => {
    expect(boardCalmForPrompt({ waiting: 0, sheetOpen: false, shiftStarted: true })).toBe(true);
    expect(boardCalmForPrompt({ waiting: 2, sheetOpen: false, shiftStarted: true })).toBe(false);
    expect(boardCalmForPrompt({ waiting: 0, sheetOpen: true, shiftStarted: true })).toBe(false);
    expect(boardCalmForPrompt({ waiting: 0, sheetOpen: false, shiftStarted: false })).toBe(false);
  });

  it('opens the board for a new order and the money screen for a cash receipt', () => {
    expect(deepLinkPath('driver-merchant://order/ord_1')).toBe('/');
    expect(deepLinkPath('driver-merchant://money')).toBe('/money');
    expect(deepLinkPath('driver://order/ord_1')).toBeNull();
  });
});

describe('pushHealthOf (MER-12)', () => {
  it('flags a device that cannot ring with the app closed', () => {
    expect(pushHealthOf({ web: false, permission: 'denied', registered: false })).toBe('off');
    expect(pushHealthOf({ web: false, permission: 'granted', registered: false })).toBe('failed');
    expect(pushHealthOf({ web: false, permission: 'granted', registered: true })).toBe('ok');
    expect(pushHealthOf({ web: false, permission: 'undetermined', registered: false })).toBe('unknown');
    expect(pushHealthOf({ web: true, permission: 'denied', registered: false })).toBe('unknown');
  });
});
