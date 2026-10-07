import { describe, expect, it } from 'vitest';
import { DEFAULT_SAFETY_PREFS, DriverError } from '@driver/contracts';
import { harness } from './test-harness.js';

/** Joy w9: the safety page's trusted people (first = the emergency contact) and its switches, in the vault. */
describe('identity: trusted contacts and safety switches', () => {
  it('starts empty with every switch off; an old emergency contact shows as the first trusted person', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    expect((await h.service.me(actor)).trustedContacts).toEqual([]);
    expect((await h.service.me(actor)).safety).toEqual(DEFAULT_SAFETY_PREFS);
    await h.service.updateProfile(actor, { emergencyContact: { name: 'أمي', phone: '0780 111 2233' } });
    expect((await h.service.me(actor)).trustedContacts).toEqual([{ name: 'أمي', phoneMasked: '+96478*****33', relation: null }]);
  });

  it('saves up to three; the first becomes the emergency contact SOS uses; kept ones never resend a number', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    const me = await h.service.updateProfile(actor, {
      trustedContacts: [
        { name: 'أمي', phone: '0780 111 2233', relation: 'mother' },
        { name: 'أختي', phone: '0790 222 3344', relation: 'sibling' },
      ],
    });
    expect(me.trustedContacts.map((c) => c.name)).toEqual(['أمي', 'أختي']);
    expect(me.emergencyContact).toEqual({ name: 'أمي', phoneMasked: '+96478*****33', relation: 'mother' });
    expect(await h.service.emergencyContactOf(actor.personId, 'system:safety', 'sos_raised')).toEqual({ name: 'أمي', phoneE164: '+9647801112233' });

    // Remove أمي, keep أختي (by index), add a friend: أختي is now the emergency contact.
    const after = await h.service.updateProfile(actor, { trustedContacts: [{ keep: 1 }, { name: 'زهراء', phone: '0771 000 9999', relation: 'friend' }] });
    expect(after.trustedContacts.map((c) => c.name)).toEqual(['أختي', 'زهراء']);
    expect(after.emergencyContact?.name).toBe('أختي');
    expect(await h.service.trustedContactsOf(actor.personId, 'system:notify', 'rajaa_arrived')).toEqual([
      { name: 'أختي', phoneE164: '+9647902223344' },
      { name: 'زهراء', phoneE164: '+9647710009999' },
    ]);
    const logs = await h.repo.vaultAccessLogs(actor.personId);
    expect(logs.at(-1)).toMatchObject({ accessorId: 'system:notify', purpose: 'rajaa_arrived', fieldsRead: ['trusted_contacts'] });
    // Nothing personal leaves the vault through events.
    expect(JSON.stringify(h.events.events)).not.toMatch(/7801112233|أمي|زهراء/);

    // [] removes everyone, the emergency contact too.
    const none = await h.service.updateProfile(actor, { trustedContacts: [] });
    expect(none.trustedContacts).toEqual([]);
    expect(none.emergencyContact).toBeNull();
  });

  it('setting the emergency contact the old way replaces the first trusted person and keeps the others', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    await h.service.updateProfile(actor, { trustedContacts: [{ name: 'أمي', phone: '0780 111 2233' }, { name: 'أختي', phone: '0790 222 3344' }] });
    const me = await h.service.updateProfile(actor, { emergencyContact: { name: 'أبوي', phone: '0770 555 6666' } });
    expect(me.trustedContacts.map((c) => c.name)).toEqual(['أبوي', 'أختي']);
  });

  it('refuses a kept index that does not exist, a duplicate number and a bad number, writing nothing', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    await expect(h.service.updateProfile(actor, { trustedContacts: [{ keep: 0 }] })).rejects.toThrow(DriverError);
    await expect(h.service.updateProfile(actor, { trustedContacts: [{ name: 'أ', phone: '0780 111 2233' }, { name: 'ب', phone: '07801112233' }] })).rejects.toThrow(DriverError);
    await expect(h.service.updateProfile(actor, { trustedContacts: [{ name: 'أ', phone: '123' }] })).rejects.toThrow(DriverError);
    expect((await h.service.me(actor)).trustedContacts).toEqual([]);
  });

  it('switches change one at a time', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    expect((await h.service.updateProfile(actor, { safety: { notifyOnArrival: true } })).safety).toEqual({ ...DEFAULT_SAFETY_PREFS, notifyOnArrival: true });
    expect((await h.service.updateProfile(actor, { safety: { autoShareRajaa: true } })).safety).toEqual({ autoShareRajaa: true, autoShareNight: false, notifyOnArrival: true });
    expect(await h.service.safetyPrefsOf(actor.personId)).toEqual({ autoShareRajaa: true, autoShareNight: false, notifyOnArrival: true });
  });

  it('«وصل بالسلامة» (ride s2): only the trusted people who have an account, as person ids, read logged', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    const sister = await h.login('07902223344');
    await h.service.updateProfile(actor, {
      trustedContacts: [
        { name: 'أمي', phone: '0780 111 2233' },
        { name: 'أختي', phone: '0790 222 3344' },
      ],
    });
    expect(await h.service.trustedContactAccounts(actor.personId, 'system:notify', 'notify_ride_safe_arrival')).toEqual([sister.actor.personId]);
    expect((await h.repo.vaultAccessLogs(actor.personId)).at(-1)).toMatchObject({ accessorId: 'system:notify', purpose: 'notify_ride_safe_arrival' });
    // Nobody trusted: nobody.
    expect(await h.service.trustedContactAccounts(sister.actor.personId, 'system:notify', 'notify_ride_safe_arrival')).toEqual([]);
  });
});
