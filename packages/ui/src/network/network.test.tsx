import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '@driver/i18n';
import { OfflineBanner } from '../components/OfflineBanner';
import { RetryState } from '../components/RetryState';
import { renderUI } from '../test/render';
import { agoText } from './ago';
import { bindOnlineManager, getNetwork, useConnectionBanner, useLoadTimeout, useNetwork } from './network';

afterEach(() => {
  vi.useRealTimers();
  // Leave the shared monitor online for the next test.
  act(() => {
    getNetwork().setDeviceOnline(true);
    getNetwork().reportResponse();
  });
});

describe('agoText (Iraqi number agreement, Western digits)', () => {
  const ago = (s: number) => agoText(s, (k, p) => t(k, p));
  it('words each range', () => {
    expect(ago(1)).toBe('قبل لحظات');
    expect(ago(5)).toBe('قبل 5 ثواني');
    expect(ago(40)).toBe('قبل 40 ثانية');
    expect(ago(65)).toBe('قبل دقيقة');
    expect(ago(130)).toBe('قبل دقيقتين');
    expect(ago(5 * 60)).toBe('قبل 5 دقايق');
    expect(ago(25 * 60)).toBe('قبل 25 دقيقة');
    expect(ago(3 * 3600)).toBe('قبل أكثر من ساعة');
  });
});

describe('network hooks', () => {
  it('useNetwork follows the browser offline / online events', () => {
    const { result } = renderHook(() => useNetwork());
    expect(result.current.online).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.state).toBe('offline');
    expect(result.current.online).toBe(false);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.online).toBe(true);
  });

  it('the strip appears within 3 s of the loss and says "رجع النت" after', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useConnectionBanner());
    act(() => getNetwork().setDeviceOnline(false));
    expect(result.current.kind).toBeNull();
    act(() => void vi.advanceTimersByTime(2_000));
    expect(result.current.kind).toBe('offline');
    act(() => getNetwork().setDeviceOnline(true));
    expect(result.current.kind).toBe('back');
    act(() => void vi.advanceTimersByTime(3_000));
    expect(result.current.kind).toBeNull();
  });

  it('stale: live channel down and data older than 45 s', () => {
    vi.useFakeTimers();
    const updatedAt = Date.now();
    const { result } = renderHook(() => useConnectionBanner({ live: 'fallback', updatedAt }));
    expect(result.current.kind).toBeNull();
    act(() => void vi.advanceTimersByTime(46_000));
    expect(result.current.kind).toBe('stale');
    expect(result.current.ageSeconds).toBe(46);
  });

  it('useLoadTimeout turns a long skeleton into "slow", and restart() gives it another round', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ loading }) => useLoadTimeout(loading, 8_000), { initialProps: { loading: true } });
    expect(result.current[0]).toBe(false);
    act(() => void vi.advanceTimersByTime(8_000));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    act(() => void vi.advanceTimersByTime(8_000));
    expect(result.current[0]).toBe(true);
    rerender({ loading: false });
    expect(result.current[0]).toBe(false);
  });

  it('bindOnlineManager pauses React Query only while the device is offline', () => {
    let online: boolean | null = null;
    bindOnlineManager({
      setEventListener: (setup) => {
        setup((v) => (online = v));
      },
    });
    expect(online).toBe(true);
    act(() => getNetwork().setDeviceOnline(false));
    expect(online).toBe(false);
    act(() => getNetwork().setDeviceOnline(true));
    expect(online).toBe(true);
  });
});

describe('OfflineBanner and RetryState', () => {
  it('renders each kind in Iraqi copy; unreachable offers "جرّب هسة"', () => {
    const onRetry = vi.fn();
    const { rerender } = renderUI(<OfflineBanner kind="offline" />);
    expect(screen.getByTestId('offline-banner-offline').textContent).toContain('النت مقطوع');
    rerender(<OfflineBanner kind="unreachable" onRetry={onRetry} />);
    fireEvent.click(screen.getByTestId('offline-banner-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<OfflineBanner kind="stale" ageSeconds={40} />);
    expect(screen.getByTestId('offline-banner-stale').textContent).toBe('التحديث متأخر · آخر تحديث قبل 40 ثانية');
    rerender(<OfflineBanner kind="back" />);
    expect(screen.getByTestId('offline-banner-back').textContent).toBe('رجع النت');
    rerender(<OfflineBanner kind={null} />);
    expect(screen.queryByTestId('offline-banner-back')).toBeNull();
  });

  it('RetryState never shows a raw network error and retries', () => {
    const onRetry = vi.fn();
    renderUI(<RetryState kind="slow" onRetry={onRetry} />);
    expect(screen.getByTestId('retry-state-slow').textContent).toContain('النت ضعيف');
    fireEvent.click(screen.getByTestId('retry-state-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('retryKindFor', () => {
  it('network state first, then the error, else slow', async () => {
    const { retryKindFor } = await import('./network');
    expect(retryKindFor({ net: { state: 'offline' }, error: { data: { httpStatus: 500 } } })).toBe('offline');
    expect(retryKindFor({ net: { state: 'unreachable' } })).toBe('unreachable');
    expect(retryKindFor({ net: { state: 'online' }, error: new TypeError('Failed to fetch') })).toBe('unreachable');
    expect(retryKindFor({ net: { state: 'online' }, error: { message: 'x', data: { httpStatus: 500 } } })).toBe('server');
    expect(retryKindFor({ net: { state: 'online' }, slow: true })).toBe('slow');
  });
});
