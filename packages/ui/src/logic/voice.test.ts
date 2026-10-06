import { describe, expect, it } from 'vitest';
import { textOf, voiceAllowed } from './voice';

describe('Marhey is only for short brand lines (joy J-D2)', () => {
  it('allows a short line with no digits', () => {
    expect(voiceAllowed('مفتوح هسة')).toBe(true);
    expect(voiceAllowed('أكل')).toBe(true);
    expect(voiceAllowed('وصل طلبك، بالعافية')).toBe(true);
  });
  it('never sets numbers in Marhey (it has no tabular digits)', () => {
    expect(voiceAllowed('يوصل 6:15')).toBe(false);
    expect(voiceAllowed('خصم ٢٠٪')).toBe(false);
    expect(voiceAllowed('۵ دقایق')).toBe(false);
  });
  it('allows at most 6 words, and not an empty line', () => {
    expect(voiceAllowed('واحد اثنين ثلاثة أربعة خمسة ستة')).toBe(true);
    expect(voiceAllowed('واحد اثنين ثلاثة أربعة خمسة ستة سبعة')).toBe(false);
    expect(voiceAllowed('   ')).toBe(false);
  });
});

describe('textOf', () => {
  it('reads plain text children, and gives up on elements', () => {
    expect(textOf('أكل')).toBe('أكل');
    expect(textOf(['مفتوح', ' ', 'هسة'])).toBe('مفتوح هسة');
    expect(textOf(12)).toBe('12');
    expect(textOf({ type: 'span' })).toBeNull();
    expect(textOf(['a', { type: 'b' }])).toBeNull();
  });
});
