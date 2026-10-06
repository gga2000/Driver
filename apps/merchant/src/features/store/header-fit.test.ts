import { describe, expect, it } from 'vitest';
import { chipsFitInline } from './header-fit';

// Widths as measured on the 1280-px tablet (rail excluded): name, switch, the money line.
const base = { row: 1187, padding: 24, gap: 12, fixed: [200, 165, 370] };

describe('tablet status bar: one row or two (m1a)', () => {
  it('busy and printer chips beside the money line fit on one row', () => {
    expect(chipsFitInline({ ...base, chips: [100, 170] })).toBe(true);
  });

  it('with the alert chips ("خلّي الشاشة شاعلة…", "فاتك اليوم: 3") the chips move to a second row instead of being clipped', () => {
    expect(chipsFitInline({ ...base, chips: [330, 185, 100, 170] })).toBe(false);
  });

  it('counts every gap and both paddings: one pixel too wide goes to two rows', () => {
    const chips = [100, 170];
    const exact = 200 + 165 + 370 + 100 + 170 + 12 * 4 + 2 * 24;
    expect(chipsFitInline({ ...base, row: exact, chips })).toBe(true);
    expect(chipsFitInline({ ...base, row: exact - 1, chips })).toBe(false);
  });

  it('a narrower tablet (900 px) degrades to two rows', () => {
    expect(chipsFitInline({ ...base, row: 900, chips: [100, 170] })).toBe(false);
  });

  it('before the first measurement, and without chips, stays on one row', () => {
    expect(chipsFitInline({ ...base, row: 0, chips: [100, 170] })).toBe(true);
    expect(chipsFitInline({ ...base, chips: [] })).toBe(true);
  });
});
