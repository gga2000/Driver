import { describe, expect, it } from 'vitest';
import type { CatalogSearchDish, TodayPot } from '@driver/contracts';
import { GALLERY_MAX, hourFood, livePots, settleSlide, tourDwellMs, tourPlan } from './gallery';

/** Baghdad wall clock → instant (2026-10-08 is a Thursday). */
const at = (local: string) => new Date(`${local.replace(' ', 'T')}:00+03:00`);
const NOON = at('2026-10-08 12:40');
/** Home's 20 s of motion (`AMBIENT_PLAY_MS` in ambient.ts, which needs the app around it to load). */
const AMBIENT_PLAY_MS = 20_000;

const pot = (kitchen: string, dish: string, over: Partial<TodayPot> = {}): TodayPot => ({
  merchantOrgId: kitchen,
  restaurantName: kitchen,
  restaurantOpen: true,
  opensAt: null,
  dish: { id: dish, name: dish, priceIqd: 5000, photoUrl: null },
  note: null,
  until: null,
  followed: false,
  ...over,
});

const pick = (kitchen: string, dish: string, over: Partial<CatalogSearchDish> = {}): CatalogSearchDish => ({
  id: dish,
  name: dish,
  description: null,
  priceIqd: 4000,
  photoUrl: null,
  available: true,
  quickAdd: true,
  restaurantId: kitchen,
  restaurantName: kitchen,
  restaurantOpen: true,
  restaurantOpensAt: null,
  ...over,
});

const ids = (hs: { dish: { id: string } }[]) => hs.map((h) => h.dish.id);

describe('livePots', () => {
  it('open kitchens only, and a pot leaves when its end time passes', () => {
    const pots = [pot('a', 'bamia'), pot('b', 'dolma', { restaurantOpen: false }), pot('c', 'qeema', { until: '14:00' }), pot('d', 'quzi', { until: '12:30' })];
    expect(livePots(pots, NOON).map((p) => p.dish.id)).toEqual(['bamia', 'qeema']);
    expect(livePots(pots, at('2026-10-08 23:40')).map((p) => p.dish.id)).toEqual(['bamia']);
    expect(livePots(undefined, NOON)).toEqual([]);
  });
});

describe('hourFood', () => {
  it('pots lead the gallery, then one dish per kitchen; the grid takes the rest in pairs', () => {
    const { slides, more } = hourFood({
      pots: [pot('musafir', 'dolma', { until: '14:00', note: 'ويا لبن' })],
      picks: [pick('khalid', 'kebab'), pick('musafir', 'qeema'), pick('sham', 'falafel'), pick('kareem', 'bamia'), pick('khalid', 'tikka'), pick('sham', 'shawarma'), pick('kareem', 'fasoulia')],
      now: NOON,
    });
    expect(ids(slides)).toEqual(['dolma', 'kebab', 'falafel', 'bamia']);
    expect(slides[0]).toMatchObject({ pot: { until: '14:00' }, line: 'ويا لبن' });
    expect(slides[1]?.pot).toBeNull();
    expect(ids(more)).toEqual(['qeema', 'tikka', 'shawarma', 'fasoulia']);
  });

  it('a pot that is also a pick keeps the pick’s one-tap add; a pot alone opens its menu', () => {
    const { slides } = hourFood({ pots: [pot('kareem', 'bamia'), pot('musafir', 'dolma')], picks: [pick('kareem', 'bamia', { description: 'مرق بامية' })], now: NOON });
    expect(slides.map((s) => s.dish.quickAdd)).toEqual([true, false]);
    expect(slides[0]?.line).toBe('مرق بامية');
  });

  it('few kitchens: their second dishes fill the gallery; an odd last dish stays out of the grid', () => {
    const { slides, more } = hourFood({ pots: [], picks: [pick('a', '1'), pick('a', '2'), pick('b', '3'), pick('a', '4'), pick('b', '5'), pick('a', '6'), pick('b', '7')], now: NOON });
    expect(ids(slides)).toEqual(['1', '3', '2', '4']);
    expect(ids(more)).toEqual(['5', '6']);
  });

  it('a dish two kitchens share, and the usual card’s kitchen, wait at the back', () => {
    const { slides, more } = hourFood({
      pots: [pot('kareem', 'bamia')],
      picks: [pick('kareem', 'qeema-k', { name: 'تمن وقيمة' }), pick('musafir', 'qeema-m', { name: 'تمن وقيمة' }), pick('khalid', 'kebab'), pick('sham', 'falafel'), pick('zahraa', 'kunafa')],
      now: NOON,
      later: 'kareem',
    });
    expect(ids(slides)).toEqual(['qeema-m', 'kebab', 'falafel', 'kunafa']);
    expect(ids(more)).toEqual(['bamia', 'qeema-k']);
  });

  it('only dishes that start with an hour word, short vowels aside', () => {
    const { slides } = hourFood({
      pots: [],
      picks: [pick('a', 'mix', { name: 'مشكل الحاج' }), pick('b', 'kleicha', { name: 'كليچة مشكلة' }), pick('c', 'wrap', { name: 'شاورما دجاج' }), pick('d', 'plate', { name: 'وجبة كبد' })],
      now: NOON,
      words: ['مشكّل', 'وجبة', 'دجاج'],
    });
    expect(ids(slides)).toEqual(['mix', 'plate']);
  });

  it('nothing sold out or closed, nothing twice, nothing at all when the town is quiet', () => {
    const { slides } = hourFood({ pots: [pot('a', 'x')], picks: [pick('a', 'x'), pick('b', 'y', { available: false }), pick('c', 'z', { restaurantOpen: false })], now: NOON });
    expect(ids(slides)).toEqual(['x']);
    expect(hourFood({ pots: undefined, picks: undefined, now: NOON })).toEqual({ slides: [], more: [] });
  });
});

describe('the gallery tour', () => {
  it('steps through once and comes back to the first', () => {
    expect(tourPlan(4)).toEqual([1, 2, 3, 0]);
    expect(tourPlan(2)).toEqual([1, 0]);
    expect(tourPlan(1)).toEqual([]);
  });

  it('fits inside home’s 20 s of motion with the steps’ glide', () => {
    for (let n = 2; n <= GALLERY_MAX; n++) {
      const dwell = tourDwellMs(n, AMBIENT_PLAY_MS - 2_000);
      expect(dwell).toBeGreaterThanOrEqual(3_000);
      expect(tourPlan(n).length * dwell).toBeLessThanOrEqual(AMBIENT_PLAY_MS - 2_000);
    }
  });

  it('a swipe settles on the nearest slide, a flick goes one further, never past the ends', () => {
    expect(settleSlide(1.3, 0, 4)).toBe(1);
    expect(settleSlide(1.3, 1.2, 4)).toBe(2);
    expect(settleSlide(1.7, -1.2, 4)).toBe(1);
    expect(settleSlide(3.4, 2, 4)).toBe(3);
    expect(settleSlide(-0.3, -2, 4)).toBe(0);
  });
});
