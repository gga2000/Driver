import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUI } from '../test/render';
import { DepartureTime } from './DepartureTime';

const NOW = new Date('2026-10-05T16:00:00Z').getTime(); // 7:00 م in Aziziyah

describe('DepartureTime', () => {
  it('draws one tile per digit, the part of day and the countdown, spoken as one sentence', () => {
    renderUI(<DepartureTime at={NOW + 52 * 60_000} now={NOW} label="تطلع" />);
    const root = screen.getByTestId('departure-time');
    expect(root.getAttribute('aria-label')).toBe('تطلع، 7:52 م، بعد 52 دقيقة');
    expect(screen.getByTestId('departure-time-digits').textContent).toBe('7:52');
    expect(screen.getByTestId('departure-time-sub').textContent).toBe('بعد 52 دقيقة');
    expect(root.textContent).toContain('م');
  });

  it('says باچر for tomorrow and lets a note replace the countdown', () => {
    renderUI(<DepartureTime at={new Date('2026-10-06T04:00:00Z')} now={NOW} note="أو من تكمل" testID="dt" />);
    expect(screen.getByTestId('dt-sub').textContent).toBe('باچر · أو من تكمل');
  });

  it('the boarding pass says «اليوم» and the part of day in words (R-06)', () => {
    renderUI(<DepartureTime at={NOW + 38 * 60_000} now={NOW} passStyle testID="pass" />);
    expect(screen.getByTestId('pass-sub').textContent).toBe('اليوم · بعد 38 دقيقة');
    expect(screen.getByTestId('pass').getAttribute('aria-label')).toBe('7:38 المسا، اليوم، بعد 38 دقيقة');
  });

  it('an accent note reads as news ("الصعود بدأ"), a plain one stays muted', () => {
    const { rerender } = renderUI(<DepartureTime at={NOW + 10 * 60_000} now={NOW} note="الصعود بدأ" noteTone="accent" testID="dt" />);
    const accent = getComputedStyle(screen.getByTestId('dt-sub')).color;
    rerender(<DepartureTime at={NOW + 10 * 60_000} now={NOW} note="الصعود بدأ" testID="dt" />);
    const muted = getComputedStyle(screen.getByTestId('dt-sub')).color;
    expect(screen.getByTestId('dt-sub').textContent).toBe('الصعود بدأ');
    expect(accent).not.toBe(muted);
  });

  it('changes digits in place when the time moves (reduced motion: no flip left behind)', () => {
    const { rerender } = renderUI(<DepartureTime at={NOW + 5 * 60_000} now={NOW} countdown={false} />);
    expect(screen.getByTestId('departure-time-digits').textContent).toBe('7:05');
    rerender(<DepartureTime at={NOW + 6 * 60_000} now={NOW} countdown={false} />);
    expect(screen.getByTestId('departure-time-digits').textContent).toBe('7:06');
    expect(screen.queryByTestId('departure-time-sub')).toBeNull();
  });
});
