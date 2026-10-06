import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOS_HOLD_MS, SosHoldTimer, sosCancelLeft, sosHold, sosSecondsCrossed } from '../logic/sos';
import { renderUI } from '../test/render';
import { SosButton, SosSheet } from './SosButton';

describe('sos hold logic', () => {
  it('fills over 3 s, counts whole seconds down, and steps with reduced motion', () => {
    expect(sosHold(0)).toEqual({ fraction: 0, secondsLeft: 3, done: false });
    expect(sosHold(1500)).toMatchObject({ fraction: 0.5, secondsLeft: 2, done: false });
    expect(sosHold(1500, SOS_HOLD_MS, true).fraction).toBeCloseTo(1 / 3, 5);
    expect(sosHold(2999)).toMatchObject({ secondsLeft: 1, done: false });
    expect(sosHold(3000)).toEqual({ fraction: 1, secondsLeft: 0, done: true });
  });

  it('crosses one haptic second at a time, never the final one twice', () => {
    expect(sosSecondsCrossed(0, 999)).toEqual([]);
    expect(sosSecondsCrossed(0, 1000)).toEqual([1000]);
    expect(sosSecondsCrossed(900, 2100)).toEqual([1000, 2000]);
    expect(sosSecondsCrossed(2100, 3400)).toEqual([]);
  });

  it('the timer fires once at 3 s and a release before that cancels', () => {
    const done = vi.fn();
    const cancel = vi.fn();
    const second = vi.fn();
    const timer = new SosHoldTimer({ onDone: done, onCancel: cancel, onSecond: second });
    timer.start(0);
    timer.tick(1200);
    timer.release(2500);
    expect(done).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(2500);
    expect(second.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
    timer.start(10_000);
    timer.tick(12_000);
    timer.tick(13_000);
    timer.tick(13_500);
    timer.release(13_600);
    expect(done).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('counts the cancel window down in whole seconds', () => {
    expect(sosCancelLeft(10_000, 0)).toBe(10);
    expect(sosCancelLeft(10_000, 9_001)).toBe(1);
    expect(sosCancelLeft(10_000, 10_000)).toBe(0);
  });
});

describe('SosButton', () => {
  let now = 0;
  const clock = () => now;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
  });
  afterEach(() => vi.useRealTimers());
  const advance = (ms: number) =>
    act(() => {
      for (let i = 0; i < ms; i += 40) {
        now += 40;
        vi.advanceTimersByTime(40);
      }
    });

  it('sends only after a full 3-second hold, with a haptic every second', () => {
    const onTrigger = vi.fn();
    const haptics = vi.fn();
    renderUI(<SosButton onTrigger={onTrigger} clock={clock} />, { haptics, reduceMotion: false });
    const button = screen.getByTestId('sos-button');
    expect(button.getAttribute('aria-label')).toContain('زر الطوارئ');
    expect(screen.getByTestId('sos-button-label').textContent).toBe('طوارئ');
    fireEvent.pointerDown(button);
    fireEvent.mouseDown(button);
    advance(1600);
    expect(screen.getByTestId('sos-button-label').textContent).toBe('طوارئ');
    expect(screen.getByTestId('sos-button-count').textContent).toBe('2');
    expect(onTrigger).not.toHaveBeenCalled();
    advance(1500);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    // press-in, 1 s, 2 s (heavy) and the send (warning)
    expect(haptics.mock.calls.map((c) => c[0])).toEqual(['heavy', 'heavy', 'heavy', 'warning']);
    expect(screen.getByTestId('sos-button-label').textContent).toBe('طوارئ');
  });

  it('letting go early sends nothing and says so', () => {
    const onTrigger = vi.fn();
    const onRelease = vi.fn();
    renderUI(<SosButton onTrigger={onTrigger} onRelease={onRelease} clock={clock} />);
    const button = screen.getByTestId('sos-button');
    fireEvent.pointerDown(button);
    fireEvent.mouseDown(button);
    advance(2000);
    fireEvent.pointerUp(button);
    fireEvent.mouseUp(button);
    advance(3000);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease.mock.calls[0]![0]).toBeGreaterThanOrEqual(1900);
  });

  it('an open alert turns it solid; a tap reopens the sheet without a new hold', () => {
    const onTrigger = vi.fn();
    const onPressActive = vi.fn();
    renderUI(<SosButton onTrigger={onTrigger} active onPressActive={onPressActive} clock={clock} />);
    fireEvent.click(screen.getByTestId('sos-button'));
    expect(onPressActive).toHaveBeenCalledTimes(1);
    expect(onTrigger).not.toHaveBeenCalled();
  });
});

describe('SosSheet', () => {
  it('says the alert arrived and offers the false-alarm cancel for 10 s', () => {
    vi.useFakeTimers();
    let now = 0;
    const onCancel = vi.fn();
    renderUI(<SosSheet phase="open" policeNumber="104" cancelUntil={10_000} contactName="أم" clock={() => now} onCancel={onCancel} onClose={() => undefined} />);
    expect(screen.getByTestId('sos-sheet-title').textContent).toBe('وصلنا تنبيهك. فريق درايفر يشوف موقعك هسة ويتصل بيك');
    expect(screen.getByTestId('sos-cancel').textContent).toContain('كنسل — تنبيه بالغلط (10)');
    fireEvent.click(screen.getByTestId('sos-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => {
      now = 10_500;
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId('sos-cancel')).toBeNull();
    expect(screen.getByTestId('sos-close').textContent).toContain('رجوع للمشوار');
    vi.useRealTimers();
  });

  it('when sending failed it says so and offers the police number', () => {
    const onCallPolice = vi.fn();
    renderUI(<SosSheet phase="failed" policeNumber="104" onClose={() => undefined} onRetry={() => undefined} onCallPolice={onCallPolice} />);
    expect(screen.getByTestId('sos-sheet-title').textContent).toContain('104');
    fireEvent.click(screen.getByTestId('sos-police'));
    expect(onCallPolice).toHaveBeenCalledTimes(1);
  });

  it('rider layout (L-17): police first and filled, the car to read out, «فريق درايفر», then a quiet cancel', () => {
    vi.useFakeTimers();
    const now = 0;
    const onCallPolice = vi.fn();
    const onCancel = vi.fn();
    const { container } = renderUI(
      <SosSheet layout="rider" phase="open" policeNumber="104" car="عباس · تويوتا كورولا أبيض · واسط 31207" cancelUntil={10_000} contactName="أم" contactNotified clock={() => now} onCancel={onCancel} onClose={() => undefined} onCallPolice={onCallPolice} />,
    );
    const order = [...container.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid'));
    const at = (id: string) => order.indexOf(id);
    expect(at('sos-police')).toBeGreaterThan(-1);
    expect(at('sos-police')).toBeLessThan(at('sos-car'));
    expect(at('sos-car')).toBeLessThan(at('sos-team'));
    expect(at('sos-team')).toBeLessThan(at('sos-cancel'));
    expect(screen.getByTestId('sos-police').textContent).toContain('اتصل بالشرطة 104');
    expect(screen.getByTestId('sos-car').textContent).toContain('واسط 31207');
    expect(screen.getByTestId('sos-team').textContent).toBe('فريق درايفر يشوف موقعك هسة ويتصل بيك');
    expect(screen.getByTestId('sos-cancel').textContent).toContain('كنسل، ضغطتها بالغلط (10)');
    fireEvent.click(screen.getByTestId('sos-police'));
    expect(onCallPolice).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('sos-share-location')).toBeNull();
    vi.useRealTimers();
  });

  it('rider layout without an emergency contact: «دز موقعي لواحد أثق بيه» opens the share sheet', () => {
    const onShareLocation = vi.fn();
    renderUI(<SosSheet layout="rider" phase="open" policeNumber="104" contactName={null} onClose={() => undefined} onShareLocation={onShareLocation} />);
    fireEvent.click(screen.getByTestId('sos-share-location'));
    expect(onShareLocation).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('ما عندك رقم طوارئ. تگدر تضيفه من حسابك')).toBeNull();
  });
});
