import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIBRARY_PHOTO_FILE } from '@driver/contracts/store-setup';
import { everyDay, LIBRARY, libraryFile, librarySuggest, normalizeAr, parsePastedMenu, readClock, sameAsDayBefore, sundayFirst, westernDigits } from './store-setup';

describe('«الصق المنيو»', () => {
  it('reads one dish a line, the price at the end, in any digits and with sections', () => {
    const got = parsePastedMenu(['مشويات:', 'كباب 7000', 'تكة لحم - 8,000 دينار', '', '# سندويشات', 'شاورما دجاج ٣٠٠٠', 'زنگر: 5 آلاف', 'عمبة إضافية 250'].join('\n'));
    expect(got.dishes.map((d) => [d.nameAr, d.priceIqd, d.categoryAr, d.short])).toEqual([
      ['كباب', 7000, 'مشويات', false],
      ['تكة لحم', 8000, 'مشويات', false],
      ['شاورما دجاج', 3000, 'سندويشات', false],
      ['زنگر', 5000, 'سندويشات', false],
      // A side at 250 is 250 dinars.
      ['عمبة إضافية', 250, 'سندويشات', false],
    ]);
    expect(got.unread).toEqual([]);
  });

  it('reads a short price as thousands and says so; a line with no price is left for a person', () => {
    const got = parsePastedMenu('صحن فلافل 3\nاسأل عن عروض اليوم');
    expect(got.dishes).toEqual([{ nameAr: 'صحن فلافل', priceIqd: 3000, categoryAr: null, short: true, line: 1 }]);
    expect(got.unread).toEqual([{ line: 2, text: 'اسأل عن عروض اليوم' }]);
  });

  it('takes a dotted thousands price and drops a dish with only a number', () => {
    expect(parsePastedMenu('برياني 12.500').dishes[0]).toMatchObject({ nameAr: 'برياني', priceIqd: 12500, short: false });
    expect(parsePastedMenu('7000').dishes).toEqual([]);
  });

  it('turns Eastern Arabic digits into 0–9', () => {
    expect(westernDigits('٣٠٠٠ و ۷۵۰')).toBe('3000 و 750');
  });
});

describe('the photo library', () => {
  it('matches a dish by any of its words, spelling aside', () => {
    expect(librarySuggest('تكة لحم غنم')[0]?.slug).toBe('tikka');
    expect(librarySuggest('زنجر دبل')[0]?.slug).toBe('zinger');
    expect(librarySuggest('شوربة عدس')[0]?.slug).toBe('lentil-soup');
    expect(librarySuggest('كرسي')).toEqual([]);
    expect(normalizeAr('باگلة')).toBe(normalizeAr('باكله'));
  });

  it('every photo is a real file on the API and a name the API takes', () => {
    const dir = path.resolve(__dirname, '../../../api/media/food');
    for (const dish of LIBRARY) {
      for (const n of dish.photos) {
        const file = libraryFile(dish.slug, n);
        expect(LIBRARY_PHOTO_FILE.test(file), file).toBe(true);
        expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
      }
    }
  });
});

describe('hours shortcuts', () => {
  it('every day the same, a day like the one before, Sunday first', () => {
    const week = everyDay('12:00', '00:00');
    expect(week).toHaveLength(7);
    const fri = { dow: 5, shifts: [{ start: '16:00', end: '00:00' }] };
    const changed = sameAsDayBefore(week.map((d) => (d.dow === 5 ? fri : d)), 6);
    expect(changed.find((d) => d.dow === 6)?.shifts).toEqual(fri.shifts);
    expect(sundayFirst([{ dow: 3, shifts: [] }]).map((d) => d.dow)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('readClock', () => {
  it('makes a typed time HH:MM, midnight included', () => {
    expect(['4', '16.30', '١٢:٠٠', '24', '9:5', '0'].map(readClock)).toEqual(['04:00', '16:30', '12:00', '00:00', '09:50', '00:00']);
    expect(['25', '12:61', 'ظهر', ''].map(readClock)).toEqual([null, null, null, null]);
  });
});
