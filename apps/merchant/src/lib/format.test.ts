import { describe, expect, it } from 'vitest';
import { amountParam, feeOrFree, iqd, roundToStep } from './money';
import { displayPhone, formatPhoneInput, isValidIraqiPhone, normalizeIraqiPhone, toWesternDigits } from './phone';

const LRI = '⁦';
const PDI = '⁩';

describe('money (voice guide §5)', () => {
  it('Western digits, comma thousands, دينار after the number', () => {
    expect(iqd(1500)).toBe('1,500 دينار');
    expect(iqd(1250000)).toBe('1,250,000 دينار');
    expect(iqd(0)).toBe('0 دينار');
    expect(iqd(500)).toBe('500 دينار');
  });
  it('never uses Eastern digits or د.ع', () => {
    const s = iqd(123456789);
    expect(s).not.toMatch(/[٠-٩]/);
    expect(s).not.toContain('د.ع');
  });
  it('English uses IQD', () => {
    expect(iqd(2000, { locale: 'en' })).toBe('2,000 IQD');
  });
  it('negative amounts use U+2212 inside an LTR isolate', () => {
    expect(iqd(-1500)).toBe(`${LRI}−1,500${PDI} دينار`);
    expect(amountParam(250, { sign: true })).toBe(`${LRI}+250${PDI}`);
  });
  it('amounts are whole dinars', () => {
    expect(amountParam(1499.6)).toBe('1,500');
    expect(amountParam(-0.4)).toBe('0');
  });
  it('free fees read as the free label', () => {
    expect(feeOrFree(0, 'توصيل مجاني')).toBe('توصيل مجاني');
    expect(feeOrFree(1000, 'توصيل مجاني')).toBe('1,000 دينار');
  });
  it('rounds to the 250 step half up', () => {
    expect(roundToStep(1124)).toBe(1000);
    expect(roundToStep(1125)).toBe(1250);
    expect(roundToStep(3600, 500)).toBe(3500);
  });
});

describe('Iraqi phone numbers', () => {
  it.each([
    ['07701234567', '+9647701234567'],
    ['0770 123 4567', '+9647701234567'],
    ['7701234567', '+9647701234567'],
    ['+964 770 123 4567', '+9647701234567'],
    ['009647701234567', '+9647701234567'],
    ['9647801234567', '+9647801234567'],
    ['٠٧٧٠١٢٣٤٥٦٧', '+9647701234567'],
    ['۰۷۵۰-۱۲۳-۴۵۶۷', '+9647501234567'],
    ['(0770) 123-4567', '+9647701234567'],
  ])('%s → %s', (raw, e164) => {
    expect(normalizeIraqiPhone(raw)).toBe(e164);
    expect(isValidIraqiPhone(raw)).toBe(true);
  });

  it.each(['', '0770123456', '077012345678', '06701234567', '+9620791234567', '1234567', 'abc'])('rejects %s', (raw) => {
    expect(normalizeIraqiPhone(raw)).toBeNull();
  });

  it('formats as typed in the local 07XX XXX XXXX form', () => {
    expect(formatPhoneInput('0')).toBe('0');
    expect(formatPhoneInput('07701')).toBe('0770 1');
    expect(formatPhoneInput('07701234567')).toBe('0770 123 4567');
    expect(formatPhoneInput('077012345678999')).toBe('0770 123 4567');
    expect(formatPhoneInput('+9647701234567')).toBe('0770 123 4567');
    expect(formatPhoneInput('7701234567')).toBe('0770 123 4567');
    expect(formatPhoneInput('٠٧٧٠١٢٣')).toBe('0770 123');
    expect(displayPhone('+9647701234567')).toBe('0770 123 4567');
  });

  it('converts Arabic-Indic and Persian digits', () => {
    expect(toWesternDigits('شارع ٣٠')).toBe('شارع 30');
    expect(toWesternDigits('۱۲۳')).toBe('123');
  });
});
