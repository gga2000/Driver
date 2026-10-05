import { describe, expect, it } from 'vitest';
import { displayPhone, whatsappUrl } from './whatsapp';

describe('support WhatsApp link', () => {
  it('builds a wa.me link with the message typed in', () => {
    expect(whatsappUrl('+964 780 000 0000', 'عندي مشكلة بطلب #1284')).toBe(`https://wa.me/9647800000000?text=${encodeURIComponent('عندي مشكلة بطلب #1284')}`);
  });
  it('shows an Iraqi number the local way', () => {
    expect(displayPhone('+9647800000000')).toBe('0780 000 0000');
    expect(displayPhone('12345')).toBe('12345');
  });
});
