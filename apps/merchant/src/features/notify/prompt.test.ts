import { describe, expect, it } from 'vitest';
import { boardCalmForPrompt, consoleAlertUrl, deepLinkPath, PREPROMPT_SNOOZE_MS, pushHealthOf, shouldShowPrePrompt, staffAlertPath, storeFromPush } from './prompt';

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

describe('storeFromPush (MER-05)', () => {
  it('switches only to another store named by the push', () => {
    expect(storeFromPush({ merchantOrgId: 'org-b' }, 'org-a')).toBe('org-b');
    expect(storeFromPush({ merchantOrgId: 'org-a' }, 'org-a')).toBeNull();
    expect(storeFromPush({}, 'org-a')).toBeNull();
    expect(storeFromPush({ merchantOrgId: 42 }, 'org-a')).toBeNull();
    expect(storeFromPush({ merchantOrgId: 'org-b' }, null)).toBe('org-b');
  });
});

describe('staff safety alerts (SOS, sweep, Console watch)', () => {
  it('opens the staff-alert screen for driver://safety links, with the incident when there is one', () => {
    expect(deepLinkPath('driver://safety/sos_123')).toBe('/staff-alert?incident=sos_123');
    expect(deepLinkPath('driver://safety')).toBe('/staff-alert');
    expect(staffAlertPath('driver://safety/')).toBe('/staff-alert');
    expect(staffAlertPath('driver://safetyx')).toBeNull();
    expect(staffAlertPath('driver://order/1')).toBeNull();
    expect(staffAlertPath(undefined)).toBeNull();
  });

  it('points at the incident in the Console, or the safety desk', () => {
    expect(consoleAlertUrl('https://console.example.org/', 'sos_123')).toBe('https://console.example.org/safety/sos_123');
    expect(consoleAlertUrl('https://console.example.org', null)).toBe('https://console.example.org/safety');
  });

  it('gives no link when the build has no Console address (no made-up default)', () => {
    expect(consoleAlertUrl(null, 'sos_123')).toBeNull();
    expect(consoleAlertUrl('', null)).toBeNull();
    expect(consoleAlertUrl('  ', 'sos_123')).toBeNull();
  });
});
