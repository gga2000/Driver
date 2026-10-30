import { describe, expect, it } from 'vitest';
import { invitePhone } from '@/features/staff/logic';
import { maskedPhone } from './phone';

const shown = (s: string | null) => s?.replace(/\u00A0/g, ' ') ?? null;

describe('d16 · one way to show a staff phone', () => {
  it('an invite hint and a whole number read «0780 ••• 4455»', () => {
    expect(shown(maskedPhone('0780 ••• 4455'))).toBe('0780 ••• 4455');
    expect(shown(maskedPhone('+9647801234455'))).toBe('0780 ••• 4455');
    expect(shown(maskedPhone('07801234455'))).toBe('0780 ••• 4455');
    expect(shown(maskedPhone('٠٧٨٠ ••• ٤٤٥٥'))).toBe('0780 ••• 4455');
  });

  it('the member form keeps the same shape, a hidden digit stays a dot', () => {
    // maskPhone on the server: "+96477" + "*****" + the last two.
    expect(shown(maskedPhone('+96477*****67'))).toBe('077• ••• ••67');
    expect(shown(maskedPhone('+96478*****44'))).toBe('078• ••• ••44');
  });

  it('never breaks across lines, and is null for anything else', () => {
    expect(maskedPhone('+96477*****67')).not.toContain(' ');
    expect(maskedPhone(null)).toBeNull();
    expect(maskedPhone('')).toBeNull();
    expect(maskedPhone('hello')).toBeNull();
    expect(maskedPhone('+1 555 0100')).toBeNull();
  });

  it('the staff list wraps it in an isolate', () => {
    expect(invitePhone({ phoneHint: '0780 ••• 4455', phoneMasked: null })).toBe('⁦0780 ••• 4455⁩');
    expect(invitePhone({ phoneHint: null, phoneMasked: '+96477*****67' })).toBe('⁦077• ••• ••67⁩');
    expect(invitePhone({ phoneHint: null, phoneMasked: null })).toBeNull();
  });
});
