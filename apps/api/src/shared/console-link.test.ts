import { describe, expect, it } from 'vitest';
import { consoleBaseFromEnv, consoleLinkParam } from './console-link.js';

describe('the Console link in staff alerts', () => {
  it('has no default address: unset or blank is no link', () => {
    expect(consoleBaseFromEnv({})).toBeNull();
    expect(consoleBaseFromEnv({ CONSOLE_BASE_URL: '  ' })).toBeNull();
    expect(consoleBaseFromEnv({ CONSOLE_BASE_URL: ' https://console.example.com/ ' })).toBe('https://console.example.com');
  });

  it('links the page when the address is set, otherwise the alert number and "open the Console on a computer"', () => {
    expect(consoleLinkParam('https://console.example.com/', '/safety/sos_1', 'sos_1')).toBe('https://console.example.com/safety/sos_1');
    expect(consoleLinkParam(null, '/safety/sos_1', 'sos_1')).toBe('رقم التنبيه: sos_1، افتح الكونسول من الكمبيوتر');
    expect(consoleLinkParam(null, '')).toBe('افتح الكونسول من الكمبيوتر');
  });
});
