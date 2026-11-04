import { fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PhotoImageProvider } from '../components/PhotoImage';
import type { ThemeName } from '@driver/design-tokens';
import { renderUI } from '../test/render';
import { BigDishCard, CompactDish, HomeChips, RestaurantCard, UsualCard, type HomeCardDish } from './cards';

const pic = { uri: 'https://x.test/p.webp' };
const dish: HomeCardDish = { id: 'd1', name: 'برياني دجاج للعائلة', restaurant: 'مطعم المسافر', minutes: 30, price: 12000, picture: pic };
const THEMES: ThemeName[] = ['sage', 'emeraldNight'];
/** Text that runs across nested spans (the price wears its own colour). */
const clean = (s: string | null | undefined) => (s ?? '').replace(/[\u200e\u200f\u2066-\u2069]/g, '');
const whole = (text: string) => (_: string, el: Element | null) => clean(el?.textContent) === text && ![...(el?.children ?? [])].some((c) => clean(c.textContent) === text);

describe('big dish card', () => {
  it('shows the daypart tag, the name, «restaurant · price · minutes» and «ضيفه للسلة»', () => {
    const onAdd = vi.fn();
    const r = renderUI(<BigDishCard dish={dish} tag="للعشا" onAdd={onAdd} testID="bd" />, { theme: 'sage' });
    expect(r.getByText('للعشا')).toBeTruthy();
    expect(r.getByText('برياني دجاج للعائلة')).toBeTruthy();
    expect(r.getByText(whole('مطعم المسافر · 12,000 دينار · 30 دقيقة'))).toBeTruthy();
    fireEvent.click(r.getByText('ضيفه للسلة'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
  it('draws the dish when the photo is missing', () => {
    const r = renderUI(<BigDishCard dish={{ ...dish, picture: undefined }} tag="للغدا اليوم" onAdd={() => {}} testID="bd" />, { theme: 'sage' });
    expect(r.getByTestId('bd-fallback')).toBeTruthy();
  });
  it('gives the add button 48 px or more and the same layout in both themes', () => {
    for (const theme of THEMES) {
      const r = renderUI(<BigDishCard dish={dish} tag="للعشا" onAdd={() => {}} testID={`bd-${theme}`} />, { theme });
      const add = r.getByTestId(`bd-${theme}-add`);
      expect(parseFloat(getComputedStyle(add).minHeight || getComputedStyle(add).height)).toBeGreaterThanOrEqual(48);
      r.unmount();
    }
  });
});

describe('compact dish row', () => {
  it('shows «restaurant · price» and a round + of 44 px that says what it adds', () => {
    const onAdd = vi.fn();
    const r = renderUI(<CompactDish dish={dish} onAdd={onAdd} testID="cd" />, { theme: 'emeraldNight' });
    expect(r.getByText(whole('مطعم المسافر · 12,000 دينار'))).toBeTruthy();
    const plus = r.getByLabelText('ضيف برياني دجاج للعائلة');
    expect(parseFloat(getComputedStyle(plus).width)).toBeGreaterThanOrEqual(44);
    fireEvent.click(plus);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe('«طلبك المعتاد»', () => {
  const props = { restaurant: 'مطعم الحجي', items: 'تمن وقيمة · لبن', price: 4500, picture: pic };
  it('says «طلبك المعتاد» on a normal day and «مثل كل جمعة» on Fridays', () => {
    const normal = renderUI(<UsualCard {...props} friday={false} onReorder={() => {}} />, { theme: 'sage' });
    expect(normal.getByText('طلبك المعتاد')).toBeTruthy();
    normal.unmount();
    const friday = renderUI(<UsualCard {...props} friday onReorder={() => {}} />, { theme: 'sage' });
    expect(friday.getByText('مثل كل جمعة')).toBeTruthy();
  });
  it('puts the restaurant and items on one line, the price under them, and «اطلبه» orders once', () => {
    const onReorder = vi.fn();
    const r = renderUI(<UsualCard {...props} friday={false} onReorder={onReorder} testID="u" />, { theme: 'emeraldNight' });
    expect(r.getByText('مطعم الحجي · تمن وقيمة · لبن')).toBeTruthy();
    expect(r.getByText(whole('4,500 دينار'))).toBeTruthy();
    fireEvent.click(r.getByText('اطلبه'));
    // One tap, one order: a quick second tap is ignored.
    fireEvent.click(r.getByText('اطلبه'));
    expect(onReorder).toHaveBeenCalledTimes(1);
  });
});

describe('restaurant card', () => {
  it('shows the full name, the rating, the minutes and the delivery fee', () => {
    const r = renderUI(<RestaurantCard name="مطعم خالد للمشويات والكص العراقي" rating={4.7} minutes={25} fee={1500} picture={pic} testID="rc" />, { theme: 'sage' });
    expect(r.getByText('مطعم خالد للمشويات والكص العراقي')).toBeTruthy();
    expect(r.getByText('4.7')).toBeTruthy();
    expect(r.getByText('25 دقيقة')).toBeTruthy();
    expect(r.getByText(whole('توصيل 1,500 دينار'))).toBeTruthy();
    expect(clean(r.getByTestId('rc').getAttribute('aria-label'))).toBe('مطعم خالد للمشويات والكص العراقي، تقييمه 4.7 من 5، يوصلك خلال 25 دقيقة، توصيل 1,500 دينار');
  });
  it('says free delivery when the fee is 0, and draws a picture when the photo is missing', () => {
    const r = renderUI(<RestaurantCard name="فلافل أبو علي" rating={4.5} minutes={12} fee={0} testID="rc" />, { theme: 'emeraldNight' });
    expect(r.getByText('توصيل مجاني')).toBeTruthy();
    expect(r.getByTestId('rc-fallback')).toBeTruthy();
  });
});

describe('home chips', () => {
  const chips = [
    { id: 'grill', label: 'مشاوي' },
    { id: 'family', label: 'للعائلة' },
    { id: 'shawarma', label: 'شاورما' },
  ];
  it('selects nothing at first, then marks the tapped chip selected', () => {
    const onSelect = vi.fn();
    const r = renderUI(<HomeChips chips={chips} selected={null} onSelect={onSelect} testID="ch" />, { theme: 'sage' });
    for (const c of chips) expect(r.getByTestId(`ch-${c.id}`).getAttribute('aria-checked')).not.toBe('true');
    fireEvent.click(r.getByText('للعائلة'));
    expect(onSelect).toHaveBeenCalledWith('family');
    r.unmount();
    const s = renderUI(<HomeChips chips={chips} selected="family" onSelect={onSelect} testID="ch" />, { theme: 'sage' });
    expect(s.getByTestId('ch-family').getAttribute('aria-checked')).toBe('true');
  });
  it('taps the selected chip again to clear it, and every chip is 44 tall', () => {
    const onSelect = vi.fn();
    const r = renderUI(<HomeChips chips={chips} selected="grill" onSelect={onSelect} testID="ch" />, { theme: 'emeraldNight' });
    fireEvent.click(r.getByText('مشاوي'));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(parseFloat(getComputedStyle(r.getByTestId('ch-grill')).minHeight)).toBeGreaterThanOrEqual(44);
  });
});

describe('round 2: honest edges', () => {
  it('a photo that fails to load turns into the dish drawing, never an empty box', () => {
    const Broken = ({ onError }: { onError?: () => void }) => {
      useEffect(() => onError?.(), [onError]);
      return null;
    };
    const r = renderUI(
      <PhotoImageProvider component={Broken}>
        <BigDishCard dish={{ ...dish, picture: { uri: 'https://x.test/missing.webp' } }} tag="للعشا" onAdd={() => {}} testID="bd" />
      </PhotoImageProvider>,
      { theme: 'sage' },
    );
    expect(r.getByTestId('bd-fallback')).toBeTruthy();
  });
  it('a restaurant with no ratings yet says «جديد», not 0.0', () => {
    const r = renderUI(<RestaurantCard name="مطعم جديد" rating={0} minutes={20} fee={1000} testID="rc" />, { theme: 'sage' });
    expect(r.getByText('جديد')).toBeTruthy();
    expect(r.queryByText('0.0')).toBeNull();
  });
});
