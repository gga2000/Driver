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

  it('changes digits in place when the time moves (reduced motion: no flip left behind)', () => {
    const { rerender } = renderUI(<DepartureTime at={NOW + 5 * 60_000} now={NOW} countdown={false} />);
    expect(screen.getByTestId('departure-time-digits').textContent).toBe('7:05');
    rerender(<DepartureTime at={NOW + 6 * 60_000} now={NOW} countdown={false} />);
    expect(screen.getByTestId('departure-time-digits').textContent).toBe('7:06');
    expect(screen.queryByTestId('departure-time-sub')).toBeNull();
  });
});
