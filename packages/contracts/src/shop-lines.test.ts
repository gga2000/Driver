import { describe, expect, it } from 'vitest';
import { errandWontFetch, SHOPPING_RULES } from './shop-lines.js';

describe('«دوّرلي» won’t-fetch words (Ali 2026-10-12)', () => {
  it.each([
    ['دوا كحة', 'medicine'],
    ['دواء للضغط', 'medicine'],
    ['دوه من الصيدلية', 'medicine'],
    ['دواي', 'medicine'],
    ['أدوية', 'medicine'],
    ['ادوية الوالدة', 'medicine'],
    ['علاج سكر', 'medicine'],
    ['شي من الصيدلية', 'medicine'],
    ['بنادول أدفانس', 'medicine'],
    ['Panadol Extra', 'medicine'],
    ['بروفين', 'medicine'],
    ['BRUFEN 400', 'medicine'],
    ['جگاير', 'cigarettes'],
    ['جكاير مالبورو', 'cigarettes'],
    ['جگايير', 'cigarettes'],
    ['باكيت جگارة', 'cigarettes'],
    ['سگاير', 'cigarettes'],
    ['سكاير', 'cigarettes'],
    ['سكائر', 'cigarettes'],
    ['سكارة', 'cigarettes'],
    ['سجاير', 'cigarettes'],
    ['سجائر', 'cigarettes'],
    ['سجارة', 'cigarettes'],
    ['سيجارة', 'cigarettes'],
    ['سيگارة', 'cigarettes'],
    ['تتن', 'cigarettes'],
    ['معسل تفاحتين', 'cigarettes'],
    ['قنينة غاز', 'gas'],
    ['بطل غاز', 'gas'],
    ['بالغاز', 'gas'],
  ] as const)('«%s» → %s', (text, kind) => {
    expect(errandWontFetch(text)).toBe(kind);
  });

  it('reads through diacritics, tatweel, hamza seats, a leading و/ال and Latin case', () => {
    expect(errandWontFetch('دَوَاء')).toBe('medicine');
    expect(errandWontFetch('دـــوا')).toBe('medicine');
    expect(errandWontFetch('وجگاير')).toBe('cigarettes');
    expect(errandWontFetch('والأدوية')).toBe('medicine');
    expect(errandWontFetch('شاحن USB، وغاز')).toBe('gas');
  });

  it('leaves everyday things alone, a fizzy drink and tools included', () => {
    for (const text of ['شاحن تايب سي', 'مشروب غازي', 'غازية', 'دفاتر من المكتبة', 'ادوات مطبخ', 'طماطة كيلو', 'لمبات', 'رصيد آسيا', 'بيض طبقة', 'دوارة']) {
      expect(errandWontFetch(text)).toBeNull();
    }
  });

  it('a «دوّرلي» bike takes up to 15 pieces', () => {
    expect(SHOPPING_RULES.errandBikeMaxPieces).toBe(15);
  });
});
