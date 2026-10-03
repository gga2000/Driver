import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { harness } from './test-harness.js';

/** Customer spec §10 + domain §13: the name and emergency contact live in the vault only. */
describe('identity.updateProfile', () => {
  it('name → vault; me returns it; nothing outside the vault carries it', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    const me = await h.service.updateProfile(actor, { name: '  علي احمد  ' });
    expect(me.name).toBe('علي احمد');
    expect((await h.repo.readIdentity(actor.personId))?.name).toBe('علي احمد');
    expect((await h.service.me(actor)).name).toBe('علي احمد');
    // The public side: the person row and every emitted event stay free of the name.
    const person = await h.repo.findPersonById(actor.personId);
    expect(JSON.stringify(person)).not.toContain('علي');
    const ev = h.events.last('person.profile_updated');
    expect(ev?.payload).toEqual({ personId: actor.personId, fields: ['name'] });
    expect(JSON.stringify(h.events.events)).not.toContain('علي');
  });

  it('emergency contact → vault (normalised), masked in me, null clears; reads are logged', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    const me = await h.service.updateProfile(actor, { emergencyContact: { name: 'أمي', phone: '0780 111 2233' } });
    expect(me.emergencyContact).toEqual({ name: 'أمي', phoneMasked: '+96478*****33' });
    expect((await h.repo.readIdentity(actor.personId))?.emergencyContact).toEqual({ name: 'أمي', phoneE164: '+9647801112233' });
    expect(JSON.stringify(h.events.events)).not.toMatch(/7801112233|أمي/);
    const logs = await h.repo.vaultAccessLogs(actor.personId);
    expect(logs.at(-1)).toMatchObject({ accessorId: actor.personId, purpose: 'self_profile', fieldsRead: ['name', 'phone_e164', 'emergency_contact'] });
    expect((await h.service.updateProfile(actor, { emergencyContact: null })).emergencyContact).toBeNull();
    // Name untouched by a contact-only update.
    expect((await h.service.updateProfile(actor, { name: 'علي' })).name).toBe('علي');
    expect((await h.service.updateProfile(actor, { emergencyContact: { name: 'أبوي', phone: '0790 000 0001' } })).name).toBe('علي');
  });

  it('a bad contact number is refused before anything is written', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    await expect(h.service.updateProfile(actor, { name: 'علي', emergencyContact: { name: 'x', phone: '12345' } })).rejects.toThrow(DriverError);
    expect((await h.repo.readIdentity(actor.personId))?.name).toBeNull();
  });

  it('each person edits only his own vault row', async () => {
    const h = harness();
    const a = await h.login('07712345678');
    const b = await h.login('07712345679');
    await h.service.updateProfile(a.actor, { name: 'علي' });
    await h.service.updateProfile(b.actor, { name: 'منار' });
    expect((await h.service.me(a.actor)).name).toBe('علي');
    expect((await h.service.me(b.actor)).name).toBe('منار');
  });

  it('member cards: name + masked phone, every read of another person logged as household_view', async () => {
    const h = harness();
    const a = await h.login('07712345678');
    const b = await h.login('07712345679');
    await h.service.updateProfile(b.actor, { name: 'منار' });
    const cards = await h.service.memberCards([a.actor.personId, b.actor.personId], a.actor.personId);
    expect(cards[b.actor.personId]).toEqual({ name: 'منار', phoneMasked: '+96477*****79' });
    const logs = await h.repo.vaultAccessLogs(b.actor.personId);
    expect(logs.some((l) => l.accessorId === a.actor.personId && l.purpose === 'household_view')).toBe(true);
    expect((await h.repo.vaultAccessLogs(a.actor.personId)).some((l) => l.purpose === 'household_view')).toBe(false);
  });

  it('first names for a work context: first token only, null without a name, each read logged with the purpose', async () => {
    const h = harness();
    const driver = await h.login('07712345670');
    const zahraa = await h.login('07712345671');
    const nameless = await h.login('07712345672');
    await h.service.updateProfile(zahraa.actor, { name: 'زهراء علي حسين' });
    const names = await h.service.firstNamesFor([zahraa.actor.personId, nameless.actor.personId, 'p_unknown'], driver.actor.personId, 'intercity_manifest');
    expect(names).toEqual({ [zahraa.actor.personId]: 'زهراء', [nameless.actor.personId]: null });
    expect(JSON.stringify(names)).not.toContain('حسين');
    const logs = await h.repo.vaultAccessLogs(zahraa.actor.personId);
    expect(logs.filter((l) => l.accessorId === driver.actor.personId && l.purpose === 'intercity_manifest')).toHaveLength(1);
  });
});
