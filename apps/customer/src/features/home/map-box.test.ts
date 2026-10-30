import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasKey } from '@driver/i18n';
import { mapBoxHeight, mapBoxNight, mapCards } from './map-box';

describe('the restaurant map cards on home', () => {
  it('starts on the drawn town, then three different shops, each with its own words', () => {
    const cards = mapCards(false);
    expect(cards.map((c) => c.id)).toEqual(['map', 'grill', 'sweets', 'cafe']);
    expect(cards[0]?.picture).toBeNull();
    expect(new Set(cards.map((c) => c.title)).size).toBe(4);
    expect(new Set(cards.map((c) => c.line)).size).toBe(4);
    for (const c of [...cards, ...mapCards(true)]) {
      expect(hasKey(c.title) && hasKey(c.line)).toBe(true);
    }
  });

  it('the shops follow the hour, and the sun card shows the other half of the day', () => {
    const day = mapCards(false);
    const night = mapCards(true);
    expect(day[1]?.picture).toContain('grill-day');
    expect(night[1]?.picture).toContain('grill-night');
    expect(day[3]?.picture).toContain('cafe-night');
    expect(day[3]?.line).toBe('home.map_card_sun_line_day');
    expect(night[3]?.picture).toContain('cafe-day');
    expect(night[3]?.line).toBe('home.map_card_sun_line_night');
  });

  it('every picture is one the API serves (apps/api/media/food, a name its photo route accepts)', () => {
    for (const c of [...mapCards(false), ...mapCards(true)]) {
      if (!c.picture) continue;
      const name = c.picture.replace('/media/food/', '');
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/);
      expect(existsSync(resolve(__dirname, '../../../../api/media/food', name))).toBe(true);
    }
  });

  it('night is 18:00 to 06:00, and the cards keep a sensible height', () => {
    expect([17, 18, 23, 0, 5, 6].map(mapBoxNight)).toEqual([false, true, true, true, true, false]);
    expect(mapBoxHeight(358)).toBe(294);
    expect(mapBoxHeight(200)).toBe(260);
    expect(mapBoxHeight(700)).toBe(340);
  });
});
