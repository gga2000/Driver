import { describe, expect, it } from 'vitest';
import { t } from '@driver/i18n';
import { CARD_MAX, CARD_SUGGESTIONS, cleanCard, giftInput, giftMessage, hidePricesAllowed, smsUrl } from './gift';
import { createGiftStore, GIFT_KEEP } from './gift-store';
import { createMemoryStorage } from '@/lib/storage';

describe('«عزيمة» (joy g1)', () => {
  it('the card is one trimmed line, at most 80 characters, or nothing', () => {
    expect(cleanCard('  بالعافية\n يمه  ')).toBe('بالعافية يمه');
    expect(cleanCard('   ')).toBeNull();
    expect(cleanCard('ي'.repeat(120))).toHaveLength(CARD_MAX);
  });

  it('hidden prices only with my wallet; they fall away with cash', () => {
    expect(hidePricesAllowed('wallet')).toBe(true);
    expect(hidePricesAllowed('cash')).toBe(false);
    expect(giftInput({ on: false, hidePrices: true }, 'wallet')).toBeUndefined();
    expect(giftInput({ on: true, hidePrices: true }, 'wallet')).toEqual({ hidePrices: true });
    expect(giftInput({ on: true, hidePrices: true }, 'cash')).toEqual({ hidePrices: false });
  });

  it('the heads-up says who pays and carries the card and the link', () => {
    const paid = giftMessage({ merchant: 'مطعم خالد', card: 'بالعافية يمه', url: 'https://x/share/a', paidByMe: true });
    expect(paid.key).toBe('gift.message_paid_card');
    const text = t(paid.key, paid.params);
    expect(text).toContain('مطعم خالد');
    expect(text).toContain('«بالعافية يمه»');
    expect(text).toContain('https://x/share/a');
    const cash = giftMessage({ merchant: 'مطعم خالد', card: null, url: 'https://x/share/a', paidByMe: false });
    expect(cash.key).toBe('gift.message_cash');
    expect(t(cash.key, cash.params)).toContain('كاش');
  });

  it('every suggestion is a real line', () => {
    for (const key of CARD_SUGGESTIONS) expect(t(key)).not.toBe(key);
  });

  it('SMS links put the body the way each phone reads it', () => {
    expect(smsUrl('+964 770 123 4567', 'هلا', 'ios')).toBe(`sms:+9647701234567&body=${encodeURIComponent('هلا')}`);
    expect(smsUrl('+9647701234567', 'هلا', 'android')).toBe(`sms:+9647701234567?body=${encodeURIComponent('هلا')}`);
  });
});

describe('gift store (this phone only)', () => {
  it('keeps the latest gifts by order and forgets the oldest', async () => {
    const store = createGiftStore(createMemoryStorage());
    await store.load();
    for (let i = 0; i < GIFT_KEEP + 2; i += 1) store.remember(`o${i}`, { name: 'أمي', phone: '+9647701234567', card: null, paidByMe: true });
    expect(store.get('o0')).toBeNull();
    expect(store.get(`o${GIFT_KEEP + 1}`)).toMatchObject({ name: 'أمي', paidByMe: true });
  });

  it('survives a reload and ignores broken records', async () => {
    const mem = createMemoryStorage();
    const a = createGiftStore(mem);
    await a.load();
    a.remember('o1', { name: 'أمي', phone: '+9647701234567', card: 'بالعافية', paidByMe: false });
    await new Promise((r) => setTimeout(r, 0));
    const b = createGiftStore(mem);
    await b.load();
    expect(b.get('o1')).toMatchObject({ card: 'بالعافية' });
    const broken = createGiftStore(createMemoryStorage({ 'driver.gifts': '[{"orderId":3}]' }));
    await broken.load();
    expect(broken.get('3')).toBeNull();
  });
});
