import { describe, expect, it } from 'vitest';
import { consoleAlertUrl, deepLinkPath, isOfferPush, PREPROMPT_SNOOZE_MS, shouldShowPrePrompt, staffAlertPath } from './prompt';

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

describe('isOfferPush (speed audit, day one)', () => {
  it('knows an offer push by its template or its /offer link', () => {
    expect(isOfferPush({ template: 'partner_new_job' })).toBe(true);
    expect(isOfferPush({ template: 'other', deepLink: 'driver-partner://offer' })).toBe(true);
    expect(isOfferPush({ template: 'chat_message', deepLink: 'driver-partner://chat/t1' })).toBe(false);
    expect(isOfferPush({})).toBe(false);
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
