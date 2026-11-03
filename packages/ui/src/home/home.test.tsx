import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ThemeName } from '@driver/design-tokens';
import { renderUI } from '../test/render';
import { HomeMapCard } from './HomeMapCard';
import { LiveBoard } from './LiveBoard';
import { CalmPanel, OffersPanel, OrderPanel, type HomeDish } from './panels';
import { PointsPill, RiverLine } from './bits';

const pic = { uri: 'https://x.test/p.webp' };
const dish = (id: string, extra: Partial<HomeDish> = {}): HomeDish => ({ id, name: 'تمن ومرق بامية', restaurant: 'مطعم خالد', minutes: 15, price: 4000, picture: pic, ...extra });
const pictures = { food: { uri: 'f' }, taxi: { uri: 't' }, tuktuk: { uri: 'k' }, intercity: { uri: 'i' } };
const departures = [
  { id: 'b', city: 'بغداد', time: '4:30', part: 'العصر', seats: 7, free: 3 },
  { id: 'k', city: 'الكوت', time: '7:00', part: 'الصبح', seats: 7, free: 5 },
];
const THEMES: ThemeName[] = ['sage', 'emeraldNight'];

describe('map card', () => {
  it('names the town with no order, and says how old the update is during one', () => {
    const idle = renderUI(<HomeMapCard map={null} town="العزيزية" />, { theme: 'sage' });
    expect(idle.getByText('مباشر · العزيزية')).toBeTruthy();
    const live = renderUI(<HomeMapCard map={null} town="العزيزية" ageSec={8} route={{ from: 'مطعم خالد', to: 'البيت' }} />, { theme: 'sage' });
    expect(live.getByText('مباشر · قبل 8 ثواني')).toBeTruthy();
    expect(live.getByText('مطعم خالد ← البيت')).toBeTruthy();
  });
  it('stops saying «مباشر» once the update is over 2 minutes old', () => {
    const r = renderUI(<HomeMapCard map={null} town="العزيزية" ageSec={300} />, { theme: 'sage' });
    expect(r.getByText('آخر تحديث قبل 5 دقايق')).toBeTruthy();
  });
});

describe('order panel', () => {
  const props = { from: 'مطعم خالد', title: 'الدليفري طلع من المطعم', stage: 'on_way' as const, minutes: 12, cash: 19250, person: { name: 'حيدر', kind: 'courier' as const } };

  it('shows the four steps: two done, one now, one to come', () => {
    const r = renderUI(<OrderPanel {...props} testID="op" />, { theme: 'sage' });
    expect(r.getAllByTestId('op-bar-done')).toHaveLength(2);
    expect(r.getAllByTestId('op-bar-now')).toHaveLength(1);
    expect(r.getAllByTestId('op-bar-next')).toHaveLength(1);
    expect(r.getByLabelText('طلبت: خلص')).toBeTruthy();
    expect(r.getByLabelText('الدليفري طلع من المطعم، يوصل خلال 12 دقيقة')).toBeTruthy();
  });
  it('shows the cash in dinars with the no-change promise, and no cash row when paid from the wallet', () => {
    const r = renderUI(<OrderPanel {...props} testID="op" />, { theme: 'sage' });
    expect(r.getByText(/19,250.*دينار/)).toBeTruthy();
    expect(r.getByText('ما يحتاج خردة: الباقي يرجعلك رصيد بمحفظتك')).toBeTruthy();
    const paid = renderUI(<OrderPanel {...props} cash={undefined} testID="paid" />, { theme: 'sage' });
    expect(paid.queryByTestId('paid-cash')).toBeNull();
  });
  it('names the courier and messages them', () => {
    const onMessage = vi.fn();
    const r = renderUI(<OrderPanel {...props} onMessage={onMessage} testID="op" />, { theme: 'sage' });
    expect(r.getByText('حيدر، دليفريك')).toBeTruthy();
    fireEvent.click(r.getByLabelText('راسل حيدر'));
    expect(onMessage).toHaveBeenCalledOnce();
  });
  it('buzzes once when the step changes, not on the first draw', () => {
    const haptics = vi.fn();
    const r = renderUI(<OrderPanel {...props} stage="preparing" />, { theme: 'sage', haptics, reduceMotion: false });
    expect(haptics).not.toHaveBeenCalled();
    r.rerender(<OrderPanel {...props} stage="on_way" />);
    expect(haptics).toHaveBeenCalledTimes(1);
  });
});

describe('the calm and offers panels', () => {
  it('calm: the town line, the fastest dish and its minutes', () => {
    const onDish = vi.fn();
    const r = renderUI(<CalmPanel town="العزيزية" open={22} dish={dish('a')} onDish={onDish} testID="calm" />, { theme: 'sage' });
    expect(r.getByText('العزيزية · 22 مطعم فاتح هسة')).toBeTruthy();
    expect(r.getByText('أسرع أكل يوصلك هسة')).toBeTruthy();
    fireEvent.click(r.getByTestId('calm-dish'));
    expect(onDish).toHaveBeenCalledWith('a');
  });
  it('offers: the meal and when it ends, a badge on each dish, the old price struck through', () => {
    const r = renderUI(
      <OffersPanel town="العزيزية" meal="lunch" until="3" dishes={[dish('a', { was: 5000 }), dish('b', { was: 3000, price: 2500 }), dish('c')]} testID="of" />,
      { theme: 'sage' },
    );
    expect(r.getByText('عروض اليوم بالعزيزية')).toBeTruthy();
    expect(r.getByText('عروض الغدا · لحد الساعة 3')).toBeTruthy();
    expect(r.getByText('عروض')).toBeTruthy();
    expect(r.getAllByText('عرض')).toHaveLength(3);
    expect(r.getByLabelText('بدل 5,000')).toBeTruthy();
  });
});

describe('the live board «شنو تحتاج؟»', () => {
  const props = { town: 'العزيزية', open: 22, rideMinutes: 3, departures, carts: 3, pictures };
  it('food count, the nearest car, the departures with their seats, parcels and carts', () => {
    const onPress = vi.fn();
    const r = renderUI(<LiveBoard {...props} onPress={onPress} testID="lb" />, { theme: 'sage' });
    expect(r.getByLabelText('أكل، 22 مطعم فاتح هسة')).toBeTruthy();
    expect(r.getByText('مطعم فاتح')).toBeTruthy();
    expect(r.getByText('أقرب سيارة')).toBeTruthy();
    expect(r.getByText('دقايق')).toBeTruthy();
    expect(r.getByLabelText('بغداد الساعة 4:30 العصر، باقي 3 مقاعد')).toBeTruthy();
    expect(r.getByTestId('seats-b').children).toHaveLength(7);
    expect(r.getAllByTestId('seat-free')).toHaveLength(8);
    expect(r.getByText('لأي باب بالعزيزية')).toBeTruthy();
    expect(r.getByText('3 فاتحة هسة')).toBeTruthy();
    fireEvent.click(r.getByTestId('lb-gov'));
    expect(onPress).toHaveBeenCalledWith('gov');
  });
  it('says so when no car is near, no trip is left today and the carts are closed', () => {
    const r = renderUI(<LiveBoard {...props} rideMinutes={null} departures={[]} carts={0} testID="lb" />, { theme: 'emeraldNight' });
    expect(r.getByText('ماكو سيارة قريبة')).toBeTruthy();
    expect(r.queryByTestId('lb-ride-minutes')).toBeNull();
    expect(r.getByText('ماكو رحلات اليوم')).toBeTruthy();
    expect(r.getByText('مسدودة هسة')).toBeTruthy();
  });
  it('4 open restaurants read «مطاعم فاتحة»', () => {
    const r = renderUI(<LiveBoard {...props} open={4} />, { theme: 'sage' });
    expect(r.getByText('مطاعم فاتحة')).toBeTruthy();
  });
});

describe('points pill and river', () => {
  it('points only, hidden at 0', () => {
    expect(renderUI(<PointsPill points={120} testID="pp" />, { theme: 'sage' }).getByText('120 نقطة')).toBeTruthy();
    expect(renderUI(<PointsPill points={0} testID="pp0" />, { theme: 'sage' }).queryByTestId('pp0')).toBeNull();
  });
  it('the river fills only during an order', () => {
    expect(renderUI(<RiverLine testID="rv" />, { theme: 'sage' }).queryByTestId('rv-fill')).toBeNull();
    expect(renderUI(<RiverLine fill={0.75} testID="rv" />, { theme: 'sage' }).getByTestId('rv-fill')).toBeTruthy();
  });
});

describe('one design, two colour sets (Ali, 2026-11-02)', () => {
  it.each([
    ['order', <OrderPanel key="o" from="مطعم خالد" title="بالطريق" stage="on_way" minutes={12} cash={19250} person={{ name: 'حيدر', kind: 'courier' }} onMessage={() => {}} />],
    ['calm', <CalmPanel key="c" town="العزيزية" open={22} dish={dish('a')} />],
    ['offers', <OffersPanel key="f" town="العزيزية" meal="dinner" until="11" dishes={[dish('a', { was: 5000 })]} />],
    ['board', <LiveBoard key="b" town="العزيزية" open={22} rideMinutes={3} departures={departures} carts={3} pictures={pictures} />],
  ])('%s says the same words in light and dark', (_, el) => {
    const [light, dark] = THEMES.map((theme) => renderUI(el, { theme }).container.textContent);
    expect(dark).toBe(light);
  });
});
