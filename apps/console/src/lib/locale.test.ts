import { t } from '@driver/i18n';
import { describe, expect, it } from 'vitest';
import { formatClock } from './format';
import { consoleDir, consoleLang } from './locale';
import { ageText } from './safety';
import { compactDuration } from './support-views';

describe('Console language plumbing (CON-19)', () => {
  it('is Iraqi Arabic, right to left, today', () => {
    expect(consoleLang()).toBe('ar-IQ');
    expect(consoleDir()).toBe('rtl');
    expect(consoleDir('en')).toBe('ltr');
  });

  it('joiners, units and the clock come from the strings, not the screens', () => {
    expect(['a', 'b'].join(t('console.list_sep'))).toBe('a، b');
    expect(t('console.list_sep', undefined, 'en')).toBe(', ');
    expect(compactDuration(150 * 60_000)).toBe('2 س 30 د');
    expect(ageText(42_000)).toBe('42 ث');
    expect(formatClock(new Date('2026-10-07T16:05:00Z'))).toBe('7:05 م');
  });
});
