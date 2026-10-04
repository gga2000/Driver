import { describe, expect, it } from 'vitest';
import {
  flatten,
  intentOf,
  matchScore,
  normalize,
  rankCommands,
  type CommandItem,
} from './command';

const pages: CommandItem[] = [
  {
    id: 'p:support',
    group: 'pages',
    label: 'الدعم',
    href: '/support',
    keywords: ['تذاكر', 'شكاوى'],
  },
  { id: 'p:dispatch', group: 'pages', label: 'التوزيع', href: '/dispatch' },
  { id: 'p:finance', group: 'pages', label: 'الكاش الليلي', href: '/finance', keywords: ['فلوس'] },
];
const drivers: CommandItem[] = [
  { id: 'd:1', group: 'drivers', label: 'حيدر ك. · تكتك · واسط 45671' },
  { id: 'd:2', group: 'drivers', label: 'مرتضى ع. · بايك' },
];
const merchants: CommandItem[] = [{ id: 'm:1', group: 'merchants', label: 'مطعم خالد' }];
const actions: CommandItem[] = [
  { id: 'a:dark', group: 'actions', label: 'الوضع الليلي', run: () => undefined },
];

describe('normalize', () => {
  it('folds hamza, ta marbuta, alef maqsura, Iraqi letters and diacritics', () => {
    expect(normalize('أحمد')).toBe(normalize('احمد'));
    expect(normalize('مكتبة')).toBe('مكتبه');
    expect(normalize('مصطفى')).toBe('مصطفي');
    expect(normalize('گاع')).toBe('كاع');
    expect(normalize('مُحَمَّد')).toBe('محمد');
    expect(normalize('ســـوق')).toBe('سوق');
  });
  it('turns Eastern digits Western', () => {
    expect(normalize('١٢٨٤')).toBe('1284');
    expect(normalize('۱۲۸۴')).toBe('1284');
  });
});

describe('matchScore', () => {
  it('prefers a whole-label start over a word start over a substring', () => {
    const start = matchScore('حيدر', 'حيدر ك.');
    const word = matchScore('تكتك', 'حيدر ك. · تكتك');
    const sub = matchScore('يدر', 'حيدر ك.');
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(0);
  });
  it('matches keywords a little below the label', () => {
    expect(matchScore('تذاكر', 'الدعم', ['تذاكر'])).toBeGreaterThan(0);
    expect(matchScore('تذاكر', 'الدعم', ['تذاكر'])).toBeLessThan(matchScore('الدعم', 'الدعم'));
  });
  it('returns 0 when nothing matches', () => {
    expect(matchScore('بغداد', 'مطعم خالد')).toBe(0);
  });
});

describe('intentOf', () => {
  it('reads order numbers the way people say them', () => {
    expect(intentOf('#1284').ticket).toBe('1284');
    expect(intentOf('1284').ticket).toBe('1284');
    expect(intentOf('١٢٨٤').ticket).toBe('1284');
    expect(intentOf('حيدر').ticket).toBeNull();
    expect(intentOf('12').ticket).toBeNull();
  });
});

describe('rankCommands', () => {
  const all = [...pages, ...drivers, ...merchants, ...actions];
  it('shows only pages and actions for an empty query', () => {
    const groups = rankCommands('', all);
    expect(groups.map((g) => g.group)).toEqual(['pages', 'actions']);
  });
  it('finds a driver by first name and a restaurant by name', () => {
    expect(flatten(rankCommands('حيدر', all)).map((i) => i.id)).toEqual(['d:1']);
    expect(flatten(rankCommands('خالد', all)).map((i) => i.id)).toEqual(['m:1']);
  });
  it('finds pages by keyword with spelling folded', () => {
    expect(flatten(rankCommands('الكاش', all))[0]!.id).toBe('p:finance');
    expect(flatten(rankCommands('شكاوي', all))[0]!.id).toBe('p:support');
  });
  it('puts orders first whatever their label', () => {
    const order: CommandItem = { id: 'o:1', group: 'orders', label: '#1284 · مطعم خالد' };
    const groups = rankCommands('1284', [...all, order]);
    expect(groups[0]!.group).toBe('orders');
  });
  it('caps each group', () => {
    const many = Array.from({ length: 10 }, (_, i): CommandItem => ({
      id: `d:${i}`,
      group: 'drivers',
      label: `علي ${i}`,
    }));
    expect(rankCommands('علي', many, 4)[0]!.items).toHaveLength(4);
  });
});
