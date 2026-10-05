import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderUI } from '../test/render';
import { StatusBanner, bannerDismissible } from './StatusBanner';

describe('StatusBanner', () => {
  it('shows the Console message as an alert; info and warning can be dismissed', () => {
    const onDismiss = vi.fn();
    renderUI(<StatusBanner severity="warning" message="الشبكة بطيئة، الطلبات توصل بس تتأخر شوية" onDismiss={onDismiss} />);
    const banner = screen.getByTestId('status-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('الشبكة بطيئة');
    fireEvent.click(screen.getByTestId('status-banner-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('status-banner-dismiss').getAttribute('aria-label')).toBe('سكّر');
  });

  it('a critical banner stays until the Console clears it (no close button) and speaks up', () => {
    renderUI(<StatusBanner severity="critical" message="الطلبات متوقفة مؤقتاً" onDismiss={() => undefined} />);
    expect(screen.queryByTestId('status-banner-dismiss')).toBeNull();
    expect(screen.getByTestId('status-banner').getAttribute('aria-live')).toBe('assertive');
    expect(bannerDismissible('critical')).toBe(false);
    expect(bannerDismissible('info')).toBe(true);
  });
});
