import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { GIFT_RECIPIENT_SMS } from './identity.service.js';
import { harness } from './test-harness.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/** G0-10: the number a gift's sender typed for the person receiving it, for the one «الدليفري يوصلك» SMS. */
describe('identity: a gift recipient number', () => {
  it('is kept in the vault by participant and read by notify, logged against the sender', async () => {
    const h = harness();
    const { actor: sender } = await h.login('07712345678');
    await h.service.rememberGiftRecipient({ participantId: 'pt_1', orderId: 'ord_1', givenById: sender.personId, phone: '0770 555 4433' });
    expect(await h.service.giftRecipientPhone('pt_1', 'system:notify', 'notify:gift_courier_near')).toBe('+9647705554433');
    expect(await h.service.giftRecipientPhone('pt_missing', 'system:notify', 'notify:gift_courier_near')).toBeNull();
    const logs = (await h.repo.vaultAccessLogs(sender.personId)).filter((l) => l.fieldsRead.includes('recipient_phone_e164'));
    expect(logs.map((l) => l.purpose)).toEqual(['notify:gift_courier_near']);
    // The number never leaves the vault through events.
    expect(JSON.stringify(h.events.events)).not.toMatch(/7705554433/);
  });

  it('refuses a number that is not an Iraqi mobile, and keeps the first number for a participant', async () => {
    const h = harness();
    expect(await code(h.service.rememberGiftRecipient({ participantId: 'pt_1', orderId: 'ord_1', givenById: 'c1', phone: '12345' }))).toBe('phone_invalid');
    await h.service.rememberGiftRecipient({ participantId: 'pt_1', orderId: 'ord_1', givenById: 'c1', phone: '07705554433' });
    await h.service.rememberGiftRecipient({ participantId: 'pt_1', orderId: 'ord_1', givenById: 'c1', phone: '07801112233' });
    expect(await h.service.giftRecipientPhone('pt_1', 'system:notify', 'test')).toBe('+9647705554433');
  });

  it(`is usable for ${GIFT_RECIPIENT_SMS.keepHours} h only`, async () => {
    const h = harness();
    await h.service.rememberGiftRecipient({ participantId: 'pt_1', orderId: 'ord_1', givenById: 'c1', phone: '07705554433' });
    h.clock.advance(GIFT_RECIPIENT_SMS.keepHours * 3_600_000 + 1);
    expect(await h.service.giftRecipientPhone('pt_1', 'system:notify', 'test')).toBeNull();
  });

  it(`texts one number for at most ${GIFT_RECIPIENT_SMS.perNumberPerDay} gifts a day, whoever sends them`, async () => {
    const h = harness();
    const n = GIFT_RECIPIENT_SMS.perNumberPerDay;
    for (let i = 0; i <= n; i++) {
      await h.service.rememberGiftRecipient({ participantId: `pt_${i}`, orderId: `ord_${i}`, givenById: `c${i}`, phone: '07705554433' });
      h.clock.advance(60_000);
    }
    const phones = await Promise.all(Array.from({ length: n + 1 }, (_, i) => h.service.giftRecipientPhone(`pt_${i}`, 'system:notify', 'test')));
    expect(phones.filter(Boolean)).toHaveLength(n);
    expect(phones[n]).toBeNull();
    // A day later the number can be texted again.
    h.clock.advance(24 * 3_600_000);
    await h.service.rememberGiftRecipient({ participantId: 'pt_next', orderId: 'ord_next', givenById: 'c1', phone: '07705554433' });
    expect(await h.service.giftRecipientPhone('pt_next', 'system:notify', 'test')).toBe('+9647705554433');
  });
});
