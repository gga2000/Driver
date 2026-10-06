import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { themes } from '@driver/design-tokens';
import { enqueueToast, remainingAfterPause, toastDuration, yieldsToNext } from '../logic/toast';
import { renderUI } from '../test/render';
import { focusRingCss } from '../theme/ThemeProvider';
import { Chip } from './Chip';
import { ListRow } from './ListRow';
import { TextField } from './TextField';
import { ToastProvider, useToast, type ToastData } from './Toast';

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('contrast and focus (audit S-04, S-13)', () => {
  it('a text field shows its edge at rest, in the 3:1 neutral', () => {
    renderUI(<TextField label="رقم الموبايل" placeholder="07xx" testID="field" />);
    const input = screen.getByPlaceholderText('07xx');
    const box = input.parentElement as HTMLElement;
    expect(box.style.borderTopColor || getComputedStyle(box).borderTopColor).toBe(rgb(themes.light.borderStrong));
  });

  it('a selected chip carries a check mark, not only the orange fill', () => {
    const { rerender } = renderUI(<Chip label="صغير" testID="chip" />);
    expect(screen.getByTestId('chip').querySelectorAll('svg').length).toBe(0);
    rerender(<Chip label="صغير" selected testID="chip" />);
    expect(screen.getByTestId('chip').querySelectorAll('svg').length).toBe(1);
    expect(screen.getByTestId('chip').getAttribute('aria-checked')).toBe('true');
  });

  it('a selected row shows a check (screen readers hear "selected" on native)', () => {
    renderUI(<ListRow title="البيت" selected onPress={() => {}} testID="row" />);
    expect(screen.getByTestId('row').querySelectorAll('svg').length).toBe(1);
  });

  it('keyboard focus draws a 2 px ink ring off the control, never on a tap', () => {
    const css = focusRingCss('#1F1A14');
    expect(css).toContain(':focus-visible{outline:2px solid #1F1A14 !important;outline-offset:2px !important}');
    expect(css).toContain(':focus:not(:focus-visible){outline:none}');
    renderUI(<Chip label="x" />);
    expect(document.getElementById('driver-focus-ring')?.textContent).toContain('#1F1A14');
  });
});

describe('toast timing (audit S-21)', () => {
  it('8 s with an action, 4 s without, twice as long with a screen reader', () => {
    expect(toastDuration({})).toBe(4000);
    expect(toastDuration({ action: {} })).toBe(8000);
    expect(toastDuration({ action: {} }, { screenReader: true })).toBe(16000);
    expect(toastDuration({}, { override: 1000 })).toBe(1000);
  });
  it('queues at most two, dropping the oldest waiting one', () => {
    expect(enqueueToast(['a', 'b'], 'c')).toEqual(['b', 'c']);
    expect(enqueueToast([], 'a')).toEqual(['a']);
  });
  it('a plain toast steps aside for a new one; a toast with an action does not', () => {
    expect(yieldsToNext({})).toBe(true);
    expect(yieldsToNext({ action: {} })).toBe(false);
    expect(yieldsToNext(null)).toBe(false);
  });
  it('a pause keeps what was left of the time', () => {
    expect(remainingAfterPause(8000, 3000)).toBe(5000);
    expect(remainingAfterPause(1000, 3000)).toBe(0);
  });
});

describe('ToastProvider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  let api: ReturnType<typeof useToast>;
  function Grab() {
    api = useToast();
    return null;
  }
  const show = (t: ToastData) => act(() => api.show(t));

  it('shows one toast at a time, the next after it leaves, with a 44 px close button', () => {
    renderUI(
      <ToastProvider>
        <Grab />
      </ToastProvider>,
    );
    show({ message: 'انحفظ', action: { label: 'تراجع', onPress: () => {} } });
    show({ message: 'ثاني' });
    expect(screen.getByText('انحفظ')).toBeTruthy();
    expect(screen.queryByText('ثاني')).toBeNull();
    const close = screen.getByTestId('toast-dismiss');
    expect(close.style.width).toBe('44px');
    expect(close.style.height).toBe('44px');
    // The action toast stays its 8 s, then the waiting one shows.
    act(() => vi.advanceTimersByTime(7900));
    expect(screen.getByText('انحفظ')).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('انحفظ')).toBeNull();
    expect(screen.getByText('ثاني')).toBeTruthy();
  });

  it('holds the timer while touched and gives time back after', () => {
    renderUI(
      <ToastProvider>
        <Grab />
      </ToastProvider>,
    );
    show({ message: 'واحد' });
    act(() => vi.advanceTimersByTime(3000));
    const surface = screen.getByText('واحد').closest('[role="alert"]')!.firstElementChild as HTMLElement;
    act(() => {
      fireEvent.mouseEnter(surface);
      fireEvent.pointerOver(surface);
    });
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('واحد')).toBeTruthy();
    act(() => {
      fireEvent.mouseLeave(surface);
      fireEvent.pointerOut(surface);
    });
    act(() => vi.advanceTimersByTime(1900));
    expect(screen.getByText('واحد')).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('واحد')).toBeNull();
  });

  it('closing sends it away and brings the next one', () => {
    renderUI(
      <ToastProvider>
        <Grab />
      </ToastProvider>,
    );
    show({ message: 'أول', action: { label: 'تراجع', onPress: () => {} } });
    show({ message: 'ثاني' });
    act(() => fireEvent.click(screen.getByTestId('toast-dismiss')));
    expect(screen.getByText('ثاني')).toBeTruthy();
  });

  it('a detail is its own quieter line under the message, never run on after it', () => {
    renderUI(
      <ToastProvider>
        <Grab />
      </ToastProvider>,
    );
    show({ message: 'رجعنالك 1,000 دينار رصيد', detail: 'آسفين على التأخير', tone: 'success' });
    const message = screen.getByText('رجعنالك 1,000 دينار رصيد');
    const detail = screen.getByText('آسفين على التأخير');
    expect(message).not.toBe(detail);
    expect(message.textContent).not.toContain('آسفين');
    expect(getComputedStyle(detail).color).not.toBe(getComputedStyle(message).color);
  });
});
