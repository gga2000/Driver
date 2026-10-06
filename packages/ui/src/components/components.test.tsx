import { useState } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderUI } from '../test/render';
import type { SeatId, SeatInfo } from '../logic/seats';
import { ChipGroup, chipRows, nextChipSelection } from './Chip';
import { CountdownRing } from './CountdownRing';
import { PriceBreakdown } from './PriceBreakdown';
import { SeatMap } from './SeatMap';

const strip = (s: string | null | undefined) => (s ?? '').replace(/[⁦⁩]/g, '');

describe('SeatMap', () => {
  const car: SeatInfo[] = [
    { id: 'front', state: 'free', premium: 2000 },
    { id: 'back_left', state: 'taken' },
    { id: 'back_middle', state: 'walkup' },
    { id: 'back_right', state: 'held' },
  ];

  function Harness({ max = 1, onReject }: { max?: number; onReject?: (id: SeatId, r: string) => void }) {
    const [sel, setSel] = useState<SeatId[]>([]);
    return (
      <>
        <SeatMap layout={4} seats={car} selection={sel} onChange={setSel} onReject={onReject} max={max} />
        <span data-testid="sel">{sel.join(',')}</span>
      </>
    );
  }

  it('renders every seat of the layout with a spoken state and the front premium', () => {
    renderUI(<Harness />);
    for (const id of ['front', 'back_left', 'back_middle', 'back_right']) expect(screen.getByTestId(`seat-${id}`)).toBeTruthy();
    const front = screen.getByTestId('seat-front');
    expect(strip(front.getAttribute('aria-label'))).toBe('قدام، فاضي، +2,000 دينار');
    expect(strip(front.textContent)).toContain('+2,000');
    expect(screen.getByTestId('seat-back_left').getAttribute('aria-label')).toBe('ورا يسار، محجوز');
  });

  it('selects a free seat, and tapping it again deselects', () => {
    const haptic = vi.fn();
    renderUI(<Harness />, { haptics: haptic });
    fireEvent.click(screen.getByTestId('seat-front'));
    expect(screen.getByTestId('sel').textContent).toBe('front');
    expect(screen.getByTestId('seat-front').getAttribute('aria-checked')).toBe('true');
    expect(haptic).toHaveBeenLastCalledWith('selection');
    fireEvent.click(screen.getByTestId('seat-front'));
    expect(screen.getByTestId('sel').textContent).toBe('');
  });

  it('rejects taken, walk-up and held seats without changing the selection', () => {
    const onReject = vi.fn();
    const haptic = vi.fn();
    renderUI(<Harness onReject={onReject} />, { haptics: haptic });
    fireEvent.click(screen.getByTestId('seat-front'));
    fireEvent.click(screen.getByTestId('seat-back_left'));
    fireEvent.click(screen.getByTestId('seat-back_middle'));
    fireEvent.click(screen.getByTestId('seat-back_right'));
    expect(onReject.mock.calls).toEqual([
      ['back_left', 'taken'],
      ['back_middle', 'walkup'],
      ['back_right', 'held'],
    ]);
    expect(haptic).toHaveBeenLastCalledWith('error');
    expect(screen.getByTestId('sel').textContent).toBe('front');
  });

  it('compact board is read-only', () => {
    const onChange = vi.fn();
    renderUI(<SeatMap layout={7} seats={[{ id: 'front', state: 'free' }]} selection={[]} onChange={onChange} compact />);
    fireEvent.click(screen.getByTestId('seat-front'));
    expect(onChange).not.toHaveBeenCalled();
    // Seats missing from the data render as taken, never as bookable.
    expect(screen.getByTestId('seat-rear_left').getAttribute('aria-label')).toContain('محجوز');
  });
});

describe('PriceBreakdown', () => {
  const items = [
    { key: 'subtotal', label: 'الأصناف', amount: 19000 },
    { key: 'delivery', label: 'التوصيل', amount: 1500, reason: 'التوصيل كله يروح للدليفري' },
    { key: 'service_fee', label: 'رسوم الخدمة', amount: 500 },
    { key: 'promo', label: 'خصم أول طلب', amount: -1500 },
    { key: 'distance', label: 'المسافة', amount: 750, shadow: true },
  ];

  it('shows each named line and the total in IQD', () => {
    renderUI(<PriceBreakdown items={items} />);
    expect(screen.getByTestId('price-line-delivery').textContent).toContain('1,500');
    expect(strip(screen.getByTestId('price-line-promo-amount').textContent)).toBe('−1,500');
    expect(screen.getByTestId('price-total-amount').textContent).toBe('19,500');
    expect(strip(screen.getByTestId('price-total').getAttribute('aria-label'))).toBe('المجموع 19,500 دينار');
    expect(screen.queryByTestId('price-rounding')).toBeNull();
  });

  it('hides shadow lines from customers and shows them, struck, when asked', () => {
    const { rerender } = renderUI(<PriceBreakdown items={items} />);
    expect(screen.queryByTestId('price-shadow-distance')).toBeNull();
    rerender(<PriceBreakdown items={items} showShadow />);
    // rerender drops the provider wrapper; the default theme context still renders correctly.
    const row = screen.getByTestId('price-shadow-distance');
    expect(row.textContent).toContain('محسوب للمعايرة');
    // Shadow lines never change the total.
    expect(screen.getByTestId('price-total-amount').textContent).toBe('19,500');
  });

  it('adds a rounding line so the visible lines always sum to the total', () => {
    renderUI(
      <PriceBreakdown
        items={[
          { key: 'base', label: 'السعر الأساسي', amount: 2000 },
          { key: 'night', label: 'رسوم الليل', amount: 350 },
        ]}
      />,
    );
    expect(strip(screen.getByTestId('price-rounding-amount').textContent)).toBe('−100');
    expect(screen.getByTestId('price-total-amount').textContent).toBe('2,250');
  });

  it('cash change shows as "الباقي رصيد" under the total, never as a rounding line that raises the price', () => {
    // Items 21,000 + fees 1,000 − deal 4,200 = 17,800 → pays 18,000 cash, 200 back to the wallet.
    renderUI(
      <PriceBreakdown
        items={[
          { key: 'items', label: 'الأصناف', amount: 21000 },
          { key: 'fees', label: 'التوصيل', amount: 1000 },
          { key: 'deal', label: 'خصم المطعم', amount: -4200 },
        ]}
        total={18000}
        change={200}
      />,
    );
    expect(screen.queryByTestId('price-rounding')).toBeNull();
    expect(screen.getByTestId('price-total-amount').textContent).toBe('18,000');
    expect(strip(screen.getByTestId('price-change-amount').textContent)).toBe('+200');
    expect(screen.getByTestId('price-change').textContent).toContain('الباقي رصيد');
    expect(strip(screen.getByTestId('price-change').textContent)).toContain('17,800');
  });

  it('uses the server total when given', () => {
    renderUI(<PriceBreakdown items={[{ key: 'base', label: 'base', amount: 1200 }]} total={1500} />);
    expect(screen.getByTestId('price-total-amount').textContent).toBe('1,500');
    expect(screen.getByTestId('price-rounding-amount').textContent).toBe('300');
  });

  it('reveals the reason for a fee on tap', () => {
    renderUI(<PriceBreakdown items={items} />);
    expect(screen.queryByText('التوصيل كله يروح للدليفري')).toBeNull();
    fireEvent.click(screen.getByTestId('price-line-delivery'));
    expect(screen.getByText('التوصيل كله يروح للدليفري')).toBeTruthy();
  });

  it('updates the total when lines change (count-up lands on the new value)', () => {
    const { rerender } = renderUI(<PriceBreakdown items={items} />);
    rerender(<PriceBreakdown items={[{ ...items[0]!, amount: 25000 }, ...items.slice(1)]} />);
    expect(screen.getByTestId('price-total').getAttribute('aria-label')).toContain('25,500');
  });
});

describe('CountdownRing', () => {
  afterEach(() => vi.useRealTimers());

  it('counts down whole seconds, goes urgent once, and expires once', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const onExpire = vi.fn();
    const haptic = vi.fn();
    renderUI(<CountdownRing mode="accept" startedAt={100_000} durationMs={20_000} onExpire={onExpire} />, { haptics: haptic });
    expect(screen.getByTestId('countdown-value').textContent).toBe('20');
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByTestId('countdown-value').textContent).toBe('15');
    expect(haptic).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(11_000));
    expect(screen.getByTestId('countdown-value').textContent).toBe('4');
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith('warning');
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByTestId('countdown-value').textContent).toBe('0');
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it('a paused ring does not tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    renderUI(<CountdownRing mode="accept" startedAt={0} durationMs={90_000} paused />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByTestId('countdown-value').textContent).toBe('90');
  });

  it('late meter moves from grace to a charged amount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const cfg = { graceMs: 180_000, stepMs: 600_000, stepAmount: 1000, forfeitMs: 1_200_000 };
    renderUI(<CountdownRing mode="late" startedAt={1_000_000 - 120_000} config={cfg} />);
    expect(screen.getByTestId('countdown-value').textContent).toBe('1:00');
    act(() => vi.advanceTimersByTime(61_000));
    expect(screen.getByTestId('countdown-value').textContent).toBe('1,000');
    act(() => vi.advanceTimersByTime(600_000));
    expect(screen.getByTestId('countdown-value').textContent).toBe('2,000');
  });
});

describe('Chip selection', () => {
  it('next selection rules', () => {
    expect(nextChipSelection([], 'a', 'single')).toEqual(['a']);
    expect(nextChipSelection(['a'], 'b', 'single')).toEqual(['b']);
    expect(nextChipSelection(['a'], 'a', 'single')).toEqual([]);
    expect(nextChipSelection(['a'], 'a', 'single', true)).toEqual(['a']);
    expect(nextChipSelection(['a'], 'b', 'multi')).toEqual(['a', 'b']);
    expect(nextChipSelection(['a', 'b'], 'a', 'multi')).toEqual(['b']);
    expect(nextChipSelection(['a'], 'a', 'multi', true)).toEqual(['a']);
  });

  function ForWhom() {
    const [v, setV] = useState<string[]>(['me']);
    return (
      <ChipGroup
        mode="single"
        required
        value={v}
        onChange={setV}
        accessibilityLabel="هذا الطلب لمنو؟"
        items={[
          { id: 'me', label: 'إلي', avatar: { name: 'علي' } },
          { id: 'sara', label: 'سارة', avatar: { name: 'سارة' } },
        ]}
      />
    );
  }

  it('"لمن؟" chips act as a required radio group', () => {
    const haptic = vi.fn();
    renderUI(<ForWhom />, { haptics: haptic });
    const me = screen.getByTestId('chip-me');
    const sara = screen.getByTestId('chip-sara');
    expect(me.getAttribute('aria-checked')).toBe('true');
    expect(sara.getAttribute('role')).toBe('radio');
    fireEvent.click(sara);
    expect(sara.getAttribute('aria-checked')).toBe('true');
    expect(me.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sara); // required: can't empty the group
    expect(sara.getAttribute('aria-checked')).toBe('true');
    expect(haptic).toHaveBeenCalledWith('selection');
  });
});

describe('ChipGroup columns', () => {
  it('lays chips out in even rows, padding the last one so no chip sits alone at full width', () => {
    expect(chipRows(['a', 'b', 'c', 'd'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(chipRows(['a', 'b', 'c'], 2)).toEqual([
      ['a', 'b'],
      ['c', null],
    ]);
    expect(chipRows(['a'], 0)).toEqual([['a']]);
    expect(chipRows([], 2)).toEqual([]);
  });

  it('renders every chip in the grid as a radio of the group', () => {
    renderUI(
      <ChipGroup
        columns={2}
        value={['n-20000']}
        onChange={() => undefined}
        accessibilityLabel="راح أدفع بـ"
        items={[
          { id: 'n-14750', label: '14,750 بالضبط' },
          { id: 'n-20000', label: '20,000' },
          { id: 'n-25000', label: '25,000' },
          { id: 'n-50000', label: '50,000' },
        ]}
      />,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByTestId('chip-n-20000').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('chip-n-50000').getAttribute('aria-checked')).toBe('false');
  });

  it('a bare amount on a chip still says its unit to a screen reader', () => {
    renderUI(
      <ChipGroup
        columns={3}
        value={['1000']}
        onChange={() => undefined}
        items={[
          { id: '500', label: '500', accessibilityLabel: '500 دينار' },
          { id: '1000', label: '1,000', accessibilityLabel: '1,000 دينار' },
          { id: '2000', label: '2,000' },
        ]}
      />,
    );
    expect(screen.getByTestId('chip-1000').getAttribute('aria-label')).toBe('1,000 دينار');
    expect(screen.getByText('1,000')).toBeTruthy();
    expect(screen.getByTestId('chip-2000').getAttribute('aria-label')).toBe('2,000');
  });
});
