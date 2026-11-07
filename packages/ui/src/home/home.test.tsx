import { act, fireEvent } from '@testing-library/react';
import * as RN from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import type { ThemeName } from '@driver/design-tokens';
import { renderUI } from '../test/render';
import { HomeMapCard } from './HomeMapCard';
import { LiveBoard } from './LiveBoard';
import { OrderPanel } from './OrderPanel';
import { CalmPanel, OffersPanel, type HomeDish } from './calmPanels';
import { PointsPill, RiverLine } from './bits';
import { HomePress } from './media';
import { countWord } from './look';
import { HomeMapCardSkeleton, LiveBoardSkeleton } from './skeletons';
const clean = (s: string | null | undefined) => (s ?? '').replace(/[\u200e\u200f\u2066-\u2069]/g, '');

const pic = { uri: 'https://x.test/p.webp' };
const dish = (id: string, extra: Partial<HomeDish> = {}): HomeDish => ({ id, name: 'تمن ومرق بامية', restaurant: 'مطعم خالد', minutes: 15, price: 4000, picture: pic, ...extra });
const pictures = { food: { uri: 'f' }, taxi: { uri: 't' }, tuktuk: { uri: 'k' }, intercity: { uri: 'i' } };
const departures = [
  { id: 'b', city: 'بغداد', time: '4:30', part: 'العصر', seats: 7, free: 3 },
  { id: 'k', city: 'الكوت', time: '7:00', part: 'الصبح', seats: 7, free: 5 },
];
const NOW = Date.UTC(2026, 10, 4, 9, 0);
const THEMES: ThemeName[] = ['sage', 'emeraldNight'];

describe('map card', () => {
  it('names the town with no order, and says how old the update is during one', () => {
    const idle = renderUI(<HomeMapCard map={null} town="العزيزية" />, { theme: 'sage' });
    expect(idle.getByText('مباشر · العزيزية')).toBeTruthy();
    const live = renderUI(<HomeMapCard map={null} town="العزيزية" updatedAt={NOW - (8) * 1000} now={NOW} route={{ from: 'مطعم خالد', to: 'البيت' }} />, { theme: 'sage' });
    expect(live.getByText('مباشر · قبل 8 ثواني')).toBeTruthy();
    expect(live.getByText('مطعم خالد ← البيت')).toBeTruthy();
  });
  it('stops saying «مباشر» once the update is over 2 minutes old', () => {
    const r = renderUI(<HomeMapCard map={null} town="العزيزية" updatedAt={NOW - (300) * 1000} now={NOW} />, { theme: 'sage' });
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
    // The steps are one stop for a screen reader.
    expect(r.getByLabelText('خطوة 3 من 4: بالطريق')).toBeTruthy();
    expect(r.getByLabelText('الدليفري طلع من المطعم، يوصل خلال 12 دقيقة')).toBeTruthy();
  });
  it('shows the cash in dinars with the no-change promise, and no cash row when paid from the wallet', () => {
    const r = renderUI(<OrderPanel {...props} testID="op" />, { theme: 'sage' });
    expect(clean(r.getByTestId('op-cash').textContent)).toContain('جهّز 19,250 دينار');
    expect(r.getByText('الخردة علينا، تنحط بمحفظتك')).toBeTruthy();
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
  it('calm: the fastest dish and its minutes, the open count said once (on the board, not here)', () => {
    const onDish = vi.fn();
    const r = renderUI(<CalmPanel dish={dish('a')} onDish={onDish} testID="calm" />, { theme: 'sage' });
    expect(r.queryByText(/مطعم فاتح/)).toBeNull();
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
    expect(r.getByLabelText(/^بدل .*5,000.*دينار$/)).toBeTruthy();
    // The parent's label carries the old price too (a native group hides its children's labels).
    expect(r.getByLabelText(/^عرض: .*، بدل .*5,000.*دينار$/)).toBeTruthy();
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
    // The departures reach screen readers through the tile's own label, and the seats are words.
    expect(r.getByLabelText('محافظات: بغداد الساعة 4:30 العصر، باقي 3 مقاعد، الكوت الساعة 7:00 الصبح، باقي 5 مقاعد')).toBeTruthy();
    expect(r.getByTestId('lb-dep-b-seats').textContent).toBe('باقي 3 مقاعد');
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
    expect(renderUI(<PointsPill points={120} testID="pp" />, { theme: 'sage' }).getByText((_, el) => clean(el?.textContent) === '120 نقطة' && el?.children.length === 0)).toBeTruthy();
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
    ['calm', <CalmPanel key="c" dish={dish('a')} />],
    ['offers', <OffersPanel key="f" town="العزيزية" meal="dinner" until="11" dishes={[dish('a', { was: 5000 })]} />],
    ['board', <LiveBoard key="b" town="العزيزية" open={22} rideMinutes={3} departures={departures} carts={3} pictures={pictures} />],
  ])('%s says the same words in light and dark', (_, el) => {
    const [light, dark] = THEMES.map((theme) => renderUI(el, { theme }).container.textContent);
    expect(dark).toBe(light);
  });
});

describe('round 2: states', () => {
  const base = { from: 'مطعم خالد', title: 'طلع من المطعم', minutes: 12 };
  it('a late order gets its own band and one clock (the new time), not one more orange sentence', () => {
    const late = renderUI(<OrderPanel {...base} stage="on_way" notice={{ tone: 'late', title: 'تأخرنا عليك · نعتذر', time: '1:40', text: 'إذا تأخرنا بعد ترجعلك أجرة التوصيل' }} testID="op" />, { theme: 'sage' });
    expect(late.getByTestId('op-late').textContent).toBe('تأخرنا عليك · نعتذر');
    expect(clean(late.getByTestId('op-new-time').textContent)).toContain('1:40');
    // One clock only: the minutes give way to the new time.
    expect(late.queryByTestId('op-minutes')).toBeNull();
    expect(late.getByTestId('op-notice').textContent).toBe('إذا تأخرنا بعد ترجعلك أجرة التوصيل');
  });
  it('a cancelled order says what happened to the money and offers the next step', () => {
    const browse = vi.fn();
    const gone = renderUI(
      <OrderPanel
        from="مطعم خالد"
        title="انلغى الطلب"
        stage="cancelled"
        cash={19250}
        person={{ name: 'حيدر', kind: 'courier' }}
        notice={{ tone: 'ended', title: 'المطعم سدّ', text: 'ما دفعت شي' }}
        actions={{ primary: { label: 'شوف مطاعم قريبة', onPress: browse }, secondary: { label: 'احجي ويانا', onPress: () => {} } }}
        testID="op"
      />,
      { theme: 'emeraldNight' },
    );
    expect(gone.queryByTestId('op-minutes')).toBeNull();
    expect(gone.queryAllByTestId(/op-bar-/)).toHaveLength(0);
    // Nothing to hand over and nobody coming.
    expect(gone.queryByTestId('op-cash')).toBeNull();
    expect(gone.queryByText(/دليفريك/)).toBeNull();
    expect(gone.getByTestId('op-notice').textContent).toBe('المطعم سدّ\nما دفعت شي');
    fireEvent.click(gone.getByText('شوف مطاعم قريبة'));
    expect(browse).toHaveBeenCalledTimes(1);
    expect(parseFloat(getComputedStyle(gone.getByTestId('op-primary')).minHeight)).toBeGreaterThanOrEqual(48);
  });
  it('offline, the minutes become an estimate and the panel says it is reconnecting', () => {
    const r = renderUI(<OrderPanel {...base} stage="on_way" offline testID="op" />, { theme: 'sage' });
    expect(r.getByText('تقريباً')).toBeTruthy();
    expect(r.getByTestId('op-offline').textContent).toContain('نحاول نتصل');
    expect(r.getByLabelText(/يوصل تقريباً خلال/)).toBeTruthy();
  });
  it('only the step happening now is orange, and the steps read «خطوة 2 من 4»', () => {
    const r = renderUI(<OrderPanel {...base} stage="preparing" testID="op" />, { theme: 'sage' });
    expect(r.getByLabelText('خطوة 2 من 4: دا يتحضّر')).toBeTruthy();
    const done = getComputedStyle(r.getByTestId('op-bar-done')).backgroundColor;
    const now = getComputedStyle(r.getByTestId('op-bar-now')).backgroundColor;
    expect(done).not.toBe(now);
  });
  it('after arrival the panel reads the title alone, without «يوصل خلال»', () => {
    const r = renderUI(<OrderPanel {...base} stage="arrived" title="وصل طلبك" testID="op" />, { theme: 'sage' });
    expect(r.queryByLabelText(/يوصل خلال/)).toBeNull();
    expect(r.queryByTestId('op-minutes')).toBeNull();
  });
  it('the cash line goes once it has arrived; a ride reads its own steps', () => {
    const done = renderUI(<OrderPanel from="مطعم خالد" title="وصل طلبك" stage="arrived" cash={14000} testID="op" />, { theme: 'sage' });
    expect(done.queryByTestId('op-cash')).toBeNull();
    const ride = renderUI(<OrderPanel from="رحلتك" title="السايق جاي" stage="preparing" ride testID="rp" />, { theme: 'sage' });
    expect(ride.getByLabelText('خطوة 2 من 4: السايق جاي')).toBeTruthy();
  });
  it('a second thing running shows «+1» on the map; a tap asks for the next one; none without it', () => {
    const next = vi.fn();
    const r = renderUI(<HomeMapCard map={null} town="العزيزية" more={{ count: 1, onPress: next }} testID="mc" />, { theme: 'sage' });
    const chip = r.getByLabelText('عندك 1 طلب ثاني شغّال، اضغط حتى تشوفه');
    expect(chip.textContent).toContain('+1');
    fireEvent.click(chip);
    expect(next).toHaveBeenCalledTimes(1);
    const one = renderUI(<HomeMapCard map={null} town="العزيزية" testID="m1" />, { theme: 'sage' });
    expect(one.queryByTestId('m1-more')).toBeNull();
  });
  it('no offers → no panel, never «0 عرض»', () => {
    const r = renderUI(<OffersPanel town="العزيزية" meal="lunch" until="3" dishes={[]} testID="of" />, { theme: 'sage' });
    expect(r.queryByTestId('of')).toBeNull();
  });
  it('the live tag says when the connection is gone', () => {
    const now = Date.UTC(2026, 10, 4, 9, 0);
    const r = renderUI(<HomeMapCard map={null} town="العزيزية" updatedAt={now - 240_000} now={now} offline testID="mc" />, { theme: 'sage' });
    expect(r.getByLabelText('ماكو انترنت · آخر تحديث قبل 4 دقايق')).toBeTruthy();
  });
  it('the word beside a big number agrees with it', () => {
    expect(countWord(1, 'home.unit.minute')).toBe('دقيقة');
    expect(countWord(5, 'home.unit.minute')).toBe('دقايق');
    expect(countWord(11, 'home.unit.minute')).toBe('دقيقة');
    expect(countWord(4, 'home.unit.open')).toBe('مطاعم فاتحة');
    expect(countWord(22, 'home.unit.open')).toBe('مطعم فاتح');
  });
  it('the points pill is a real button when it can be tapped', () => {
    const onPress = vi.fn();
    const r = renderUI(<PointsPill points={120} onPress={onPress} testID="pp" />, { theme: 'sage' });
    fireEvent.click(r.getByTestId('pp'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(r.getByTestId('pp').getAttribute('role')).toBe('button');
  });
  it('loading shows the shapes of the cards, announced once each', () => {
    const r = renderUI(
      <>
        <HomeMapCardSkeleton testID="sk-map" />
        <LiveBoardSkeleton testID="sk-board" />
      </>,
      { theme: 'emeraldNight' },
    );
    expect(r.getByTestId('sk-map').getAttribute('aria-label')).toBe('لحظة…');
    expect(r.getByTestId('sk-board')).toBeTruthy();
  });
});

describe('round 3: live honesty and large text', () => {
  it('the live tag counts on by itself: every second at first, then every 30 seconds, and turns stale', () => {
    vi.useFakeTimers();
    const announce = vi.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const start = Date.UTC(2026, 10, 4, 9, 0);
    vi.setSystemTime(start);
    try {
      const r = renderUI(<HomeMapCard map={null} town="العزيزية" updatedAt={start} testID="m" />, { theme: 'sage' });
      const read = () => clean(r.getByTestId('m-live').getAttribute('aria-label'));
      const first = read();
      for (let i = 0; i < 20; i++) act(() => vi.advanceTimersByTime(1_000));
      expect(read()).not.toBe(first);
      for (let i = 0; i < 8; i++) act(() => vi.advanceTimersByTime(30_000));
      // Going stale is said once, not again each minute the age ticks on.
      expect(announce).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 4; i++) act(() => vi.advanceTimersByTime(30_000));
      expect(announce).toHaveBeenCalledTimes(1);
    } finally {
      announce.mockRestore();
      vi.useRealTimers();
    }
  });
  it('the map is named on its own, so its pins stay reachable, and a cancelled map stands still', () => {
    const r = renderUI(<HomeMapCard map={<span data-testid="pin" />} town="العزيزية" testID="m" />, { theme: 'sage' });
    expect(r.getByTestId('m-map-name').contains(r.getByTestId('pin'))).toBe(false);
    r.unmount();
    const frozen = renderUI(<HomeMapCard map={null} town="العزيزية" frozen testID="m" />, { theme: 'sage' });
    expect(frozen.queryByTestId('m-live')).toBeNull();
  });
  it('offline, the board stops claiming live numbers', () => {
    const r = renderUI(<LiveBoard town="العزيزية" open={22} rideMinutes={3} departures={departures} carts={3} pictures={pictures} offline testID="b" />, { theme: 'emeraldNight' });
    expect(r.queryByTestId('b-ride-minutes')).toBeNull();
    expect(r.getAllByText('ما نعرف هسة').length).toBeGreaterThanOrEqual(2);
  });
  it('at a large text size the board pictures step aside so the words never collide', () => {
    const spy = vi.spyOn(RN, 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1.6 });
    try {
      const big = renderUI(<LiveBoard town="العزيزية" open={22} rideMinutes={3} departures={departures} carts={3} pictures={pictures} testID="b" />, { theme: 'sage' });
      expect(big.container.querySelectorAll('img').length).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('round 4: edges', () => {
  it('no restaurant open: the food tile says so, never «0 مطعم فاتح»', () => {
    const r = renderUI(<LiveBoard town="العزيزية" open={0} rideMinutes={3} departures={departures} carts={3} pictures={pictures} testID="b" />, { theme: 'sage' });
    expect(r.getByTestId('b-food-closed').textContent).toBe('المطاعم مسدودة هسة');
    expect(r.queryByText('0')).toBeNull();
  });
  it('a full departure reads «كاملة», not «باقي 0»', () => {
    const r = renderUI(<LiveBoard town="العزيزية" open={5} rideMinutes={3} departures={[{ ...departures[0]!, free: 0 }]} carts={3} pictures={pictures} testID="b" />, { theme: 'sage' });
    expect(r.getByTestId(`b-dep-${departures[0]!.id}-seats`).textContent).toBe('كاملة');
  });
  it('a late notice without a new time keeps the minutes and still shows the band', () => {
    const r = renderUI(<OrderPanel from="مطعم خالد" title="طلع من المطعم" minutes={9} stage="on_way" notice={{ tone: 'late', title: 'تأخرنا عليك · نعتذر' }} testID="op" />, { theme: 'emeraldNight' });
    expect(r.getByTestId('op-late')).toBeTruthy();
    expect(r.getByTestId('op-minutes')).toBeTruthy();
    expect(r.queryByTestId('op-new-time')).toBeNull();
  });
  it('the map card and its loading shape are the same height in each mode', () => {
    const quiet = renderUI(<HomeMapCard map={null} town="العزيزية" testID="m" />, { theme: 'sage' });
    const shape = renderUI(<HomeMapCardSkeleton testID="s" />, { theme: 'sage' });
    const h = (el: HTMLElement) => getComputedStyle(el.firstElementChild as HTMLElement).height;
    expect(h(quiet.getByTestId('m'))).toBe(h(shape.getByTestId('s').firstElementChild as HTMLElement));
  });
  it('other themes borrow the home colours by light or dark', () => {
    const light = renderUI(<CalmPanel dish={dish('a')} testID="c" />, { theme: 'light' });
    const dark = renderUI(<CalmPanel dish={dish('a')} testID="c2" />, { theme: 'dark' });
    expect(getComputedStyle(light.getByTestId('c')).backgroundColor).not.toBe(getComputedStyle(dark.getByTestId('c2')).backgroundColor);
  });
});

describe('round 5: edges', () => {
  it('minutes are whole and never below 0; at 0 the panel says «يوصل هسة»', () => {
    const r = renderUI(<OrderPanel from="مطعم خالد" title="طلع من المطعم" minutes={-3} stage="on_way" testID="op" />, { theme: 'sage' });
    expect(r.queryByTestId('op-minutes')).toBeNull();
    expect(r.getByTestId('op-arriving').textContent).toBe('يوصل هسة');
  });
  it('a tap goes through again once the guard time has passed', () => {
    vi.useFakeTimers();
    try {
      const onReorder = vi.fn();
      const r = renderUI(<CalmPanel usual={{ id: 'u', restaurant: 'مطعم الحجي', items: 'تمن وقيمة', price: 4500, friday: false }} onReorder={onReorder} testID="cp" />, { theme: 'sage' });
      fireEvent.click(r.getByText('اطلبه'));
      vi.advanceTimersByTime(1300);
      fireEvent.click(r.getByText('اطلبه'));
      expect(onReorder).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('a new step is announced to screen readers once', () => {
    const spy = vi.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    try {
      const r = renderUI(<OrderPanel from="مطعم خالد" title="دا يتحضّر" minutes={20} stage="preparing" testID="op" />, { theme: 'sage' });
      expect(spy).not.toHaveBeenCalled();
      r.rerender(<OrderPanel from="مطعم خالد" title="طلع من المطعم" minutes={12} stage="on_way" testID="op" />);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('طلع من المطعم');
    } finally {
      spy.mockRestore();
    }
  });
  it('a cancelled card drops the map and the live tag', () => {
    const r = renderUI(<HomeMapCard map={<span data-testid="pin" />} town="العزيزية" frozen testID="m" />, { theme: 'sage' });
    expect(r.queryByTestId('pin')).toBeNull();
    expect(r.queryByTestId('m-live')).toBeNull();
  });
});

describe('round 6: edges', () => {
  it('ride minutes are whole; at 0 the tile says a car is right there', () => {
    const r = renderUI(<LiveBoard town="العزيزية" open={5} rideMinutes={3.6} departures={departures} carts={1} pictures={pictures} testID="b" />, { theme: 'sage' });
    expect(r.getByTestId('b-ride-minutes').textContent).toBe('4');
    r.unmount();
    const here = renderUI(<LiveBoard town="العزيزية" open={5} rideMinutes={0} departures={departures} carts={1} pictures={pictures} testID="b" />, { theme: 'sage' });
    expect(here.queryByTestId('b-ride-minutes')).toBeNull();
    expect(here.getByTestId('b-ride-here')).toBeTruthy();
  });
  it('a cancellation is spoken once, with its notice', () => {
    const spy = vi.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    try {
      const r = renderUI(<OrderPanel from="مطعم خالد" title="دا يتحضّر" minutes={20} stage="preparing" testID="op" />, { theme: 'sage' });
      r.rerender(<OrderPanel from="مطعم خالد" title="انلغى الطلب" stage="cancelled" notice={{ tone: 'ended', title: 'المطعم سدّ' }} testID="op" />);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('انلغى الطلب. المطعم سدّ');
      expect(r.container.querySelector('[aria-live="polite"]')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
  it('the river is dimmed at night and empty with no order', () => {
    const night = renderUI(<RiverLine fill={0.5} testID="rv" />, { theme: 'emeraldNight' });
    expect(parseFloat(getComputedStyle(night.getByTestId('rv')).opacity)).toBeLessThan(1);
    const none = renderUI(<RiverLine fill={0} testID="rv0" />, { theme: 'sage' });
    expect(none.queryByTestId('rv0-fill')).toBeNull();
  });
});

describe('audit round 7', () => {
  it('a late notice that arrives mid-step is said once, with a warning buzz', () => {
    const spy = vi.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const haptics = vi.fn();
    try {
      const base = { from: 'مطعم خالد', title: 'طلع من المطعم', stage: 'on_way' as const, minutes: 12, testID: 'op' };
      const r = renderUI(<OrderPanel {...base} />, { theme: 'sage', haptics, reduceMotion: false });
      const late = { tone: 'late' as const, title: 'تأخرنا عليك · نعتذر', time: '1:40 الظهر' };
      r.rerender(<OrderPanel {...base} notice={late} />);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('طلع من المطعم. تأخرنا عليك · نعتذر');
      expect(haptics).toHaveBeenLastCalledWith('warning');
      r.rerender(<OrderPanel {...base} notice={late} minutes={11} />);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
  it('a fractional minute from the server is shown whole, with the right word', () => {
    const r = renderUI(<CalmPanel dish={dish('d', { minutes: 12.6 })} testID="cp" />, { theme: 'sage' });
    const text = clean(r.container.textContent);
    expect(text).toContain('13');
    expect(text).not.toContain('12.6');
  });
  it('an offer passes its own id when tapped', () => {
    const onDish = vi.fn();
    const r = renderUI(<OffersPanel town="العزيزية" meal="lunch" until="3" dishes={[dish('a'), dish('b', { was: 5000 })]} onDish={onDish} testID="of" />, { theme: 'sage' });
    fireEvent.click(r.getByTestId('of-dish-b'));
    expect(onDish).toHaveBeenCalledWith('b');
  });
  it('the usual order says how long it takes today when that is known', () => {
    const r = renderUI(<CalmPanel usual={{ id: 'u', restaurant: 'مطعم الحجي', items: 'تمن وقيمة', price: 4500, friday: false, minutes: 25 }} onReorder={() => {}} testID="cp" />, { theme: 'sage' });
    expect(clean(r.container.textContent)).toMatch(/4,500 دينار · 25 دقيقة/);
  });
  it('a courier with no name gets a person mark, never a blank circle', () => {
    const r = renderUI(<OrderPanel from="مطعم خالد" title="وصل طلبك للمطعم" stage="placed" minutes={25} person={{ name: '  ', kind: 'courier' }} testID="op" />, { theme: 'sage' });
    // At the first step nothing else on the panel draws an icon, so the one svg is the person mark.
    expect(r.container.querySelectorAll('svg')).toHaveLength(1);
  });
  it('the live tag turns stale right at the line, not up to 30 seconds later', () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 10, 4, 9, 0);
    vi.setSystemTime(start);
    try {
      const r = renderUI(<HomeMapCard map={null} town="العزيزية" updatedAt={start - 100_000} testID="m" />, { theme: 'sage' });
      const read = () => clean(r.getByTestId('m-live').getAttribute('aria-label'));
      expect(read()).toContain('مباشر');
      act(() => vi.advanceTimersByTime(21_000));
      expect(read()).not.toContain('مباشر');
    } finally {
      vi.useRealTimers();
    }
  });
  it('offline, the route pill steps back with the old picture', () => {
    const r = renderUI(<HomeMapCard map={null} town="العزيزية" offline route={{ from: 'مطعم خالد', to: 'البيت' }} testID="m" />, { theme: 'sage' });
    expect(parseFloat(getComputedStyle(r.getByTestId('m-route')).opacity)).toBeLessThan(1);
  });
  it('a switched-off press says so and ignores the tap', () => {
    const onPress = vi.fn();
    const r = renderUI(<HomePress onPress={onPress} disabled accessibilityLabel="اطلبه" testID="hp"><RN.Text>اطلبه</RN.Text></HomePress>, { theme: 'sage' });
    fireEvent.click(r.getByTestId('hp'));
    expect(onPress).not.toHaveBeenCalled();
    expect(r.getByTestId('hp').getAttribute('aria-disabled')).toBe('true');
  });
  it('an arrived order drops the late band and the new time', () => {
    const r = renderUI(<OrderPanel from="مطعم خالد" title="وصل" stage="arrived" notice={{ tone: 'late', title: 'تأخرنا عليك · نعتذر', time: '1:40 الظهر' }} testID="op" />, { theme: 'sage' });
    expect(r.queryByTestId('op-late')).toBeNull();
    expect(r.queryByTestId('op-new-time')).toBeNull();
  });
  it('tomorrow\'s first car says «باچر», on screen and to screen readers', () => {
    const r = renderUI(<LiveBoard town="العزيزية" open={5} rideMinutes={3} departures={[{ id: 'k', city: 'الكوت', time: '7:00', part: 'الصبح', tomorrow: true, seats: 7, free: 5 }]} carts={1} pictures={pictures} testID="lb" />, { theme: 'sage' });
    expect(clean(r.container.textContent)).toContain('باچر الصبح');
  });
});
