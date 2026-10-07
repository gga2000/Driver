import { describe, expect, it } from 'vitest';
import { contrastRatio, decor, services, themes, type ThemeName } from '@driver/design-tokens';
import { FOOD_DOORS } from '@driver/contracts';
import { doorSwatch } from './palette';

describe.each(['istikan', 'istikanNight', 'light', 'dark'] as ThemeName[])(
  '%s: the food doors read',
  (name) => {
    const theme = { services: services[name], decor: decor[name], colors: themes[name] };
    it.each(FOOD_DOORS)('%s: name and fact pass AA on the door; page text on its wash', (door) => {
      const s = doorSwatch(theme, door);
      expect(contrastRatio(s.on, s.fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(s.sub, s.fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.colors.text, s.tint)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.colors.textMuted, s.tint)).toBeGreaterThanOrEqual(4.5);
    });
    it('four doors, four colours', () => {
      const fills = FOOD_DOORS.map((d) => doorSwatch(theme, d).fill);
      expect(new Set(fills).size).toBe(4);
    });
  },
);
