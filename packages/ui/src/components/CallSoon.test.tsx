import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderUI } from '../test/render';
import { CallSoonButton, CallSoonIcon } from './CallSoon';

describe('call button while calls are not live (G0-10)', () => {
  it('the round button says «قريباً» and still answers a tap', () => {
    const onPress = vi.fn();
    renderUI(<CallSoonIcon onPress={onPress} />);
    expect(screen.getByText('قريباً')).toBeTruthy();
    expect(screen.getByTestId('call-soon').getAttribute('aria-label')).toBe('الاتصال قريباً');
    fireEvent.click(screen.getByTestId('call-soon'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('the full button reads «اتصال» with «قريباً» on its end', () => {
    const onPress = vi.fn();
    renderUI(<CallSoonButton onPress={onPress} fullWidth />);
    expect(screen.getByTestId('call-soon').textContent).toContain('اتصال');
    expect(screen.getByTestId('call-soon').textContent).toContain('قريباً');
    fireEvent.click(screen.getByTestId('call-soon'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
