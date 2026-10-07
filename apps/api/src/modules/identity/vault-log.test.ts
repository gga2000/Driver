import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { vaultLogFailsClosed, vaultLogRow } from './identity.repository.js';
import { harness } from './test-harness.js';
import { STAFF_READ_PURPOSES, VaultLogWriteError, accessorOf, swallowedVaultLogFailures } from './vault-log.js';

/** vault_accessor_fk: synthetic readers, and what happens when the access log row cannot be written. */
describe('vault access log: accessors and failures', () => {
  it('a person reads as a person; the system, a share link and an SOS link read as kind + ref', () => {
    expect(accessorOf('cmg0abc123')).toEqual({ kind: 'person', personId: 'cmg0abc123', ref: null });
    expect(accessorOf('system:notify')).toEqual({ kind: 'system', personId: null, ref: 'system:notify' });
    expect(accessorOf('share:lnk_1')).toEqual({ kind: 'share_link', personId: null, ref: 'share:lnk_1' });
    expect(accessorOf('sos_link:inc_1')).toEqual({ kind: 'sos_link', personId: null, ref: 'sos_link:inc_1' });
    expect(accessorOf('e2e:probe')).toEqual({ kind: 'synthetic', personId: null, ref: 'e2e:probe' });
    // The row a synthetic reader writes never names a person in accessor_id (the foreign key to people).
    expect(vaultLogRow({ personId: 'p1', accessorId: 'system:khat', purpose: 'khat_sweep_page', fieldsRead: ['name'] })).toMatchObject({ accessorId: null, accessorKind: 'system', accessorRef: 'system:khat' });
    expect(vaultLogRow({ personId: 'p1', accessorId: 'p2', purpose: 'chat_thread', fieldsRead: ['name'] })).toMatchObject({ accessorId: 'p2', accessorKind: 'person', accessorRef: null });
  });

  it('every vault purpose a staff module uses fails closed, or is named as allowed open', () => {
    // Purposes that may stay fail-open, each with why: none of them shows personal data on a staff screen.
    const allowedOpen: Record<string, string> = {
      merchant_onboarding: 'ensurePersonByPhone: makes the person from the phone the staff typed, returns only an id',
      phone_booking: 'ensurePersonByPhone: makes the caller from the phone the staff typed, returns only an id',
      phone_booking_sms: "system:notify reads the driver's name for the caller's SMS, no staff screen",
    };
    const readers = 'names\\.of|firstNamesFor|displayNamesFor|vaultRefsFor|invitePhoneHints|ensurePersonByPhone|phonesFor|phoneFor';
    // Up to two levels of nested parentheses inside the call, e.g. `names.of(items.map((i) => i.by), …)`.
    const call = new RegExp(`(?:${readers})\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*?'([a-z_]+)'`, 'g');
    const constant = /export const [A-Z_]+_PURPOSE = '([a-z_]+)'/g;
    const purposes = new Set<string>();
    for (const mod of ['console', 'control-room', 'controls', 'ops', 'support', 'phone-booking']) {
      const dir = join(import.meta.dirname, '..', mod);
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
        const src = readFileSync(join(dir, f), 'utf8');
        for (const m of src.matchAll(call)) purposes.add(m[1]!);
        for (const m of src.matchAll(constant)) purposes.add(m[1]!);
      }
    }
    // The scan really finds the Console's reads (a regex that matches nothing would pass silently).
    expect([...purposes]).toEqual(expect.arrayContaining(['approvals_queue', 'finance_cash_desk', 'console_names', 'support_case', 'phone_booking_list', 'document_review']));
    for (const p of purposes) expect(STAFF_READ_PURPOSES.has(p) || p in allowedOpen, p).toBe(true);
    for (const p of Object.keys(allowedOpen)) expect(STAFF_READ_PURPOSES.has(p), p).toBe(false);
  });

  it('only Console staff purposes fail closed (or an explicit failClosed)', () => {
    expect(vaultLogFailsClosed('console_names')).toBe(true);
    expect(vaultLogFailsClosed('safety_desk')).toBe(true);
    expect(vaultLogFailsClosed('sos_raised')).toBe(false);
    expect(vaultLogFailsClosed('notify:otp_login')).toBe(false);
    expect(vaultLogFailsClosed('share_trip')).toBe(false);
    expect(vaultLogFailsClosed('share_trip', { failClosed: true })).toBe(true);
    expect(STAFF_READ_PURPOSES.has('document_review')).toBe(true);
  });

  it('a notify or SOS read still returns its data when the log write fails, and the failure is counted', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    await h.service.updateProfile(actor, { emergencyContact: { name: 'أمي', phone: '0780 111 2233' } });
    const before = swallowedVaultLogFailures();
    h.repo.failLogWrites = 2;
    expect(await h.service.emergencyContactOf(actor.personId, 'system:safety', 'sos_raised')).toEqual({ name: 'أمي', phoneE164: '+9647801112233' });
    expect((await h.service.notifyContact(actor.personId, { phone: true, purpose: 'notify:otp_login' }))?.phoneE164).toBe('+9647712345678');
    expect(swallowedVaultLogFailures()).toBe(before + 2);
  });

  it('a Console staff read whose log write fails returns no data', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    await h.service.setName(actor, 'حيدر كاظم');
    const staff = (await h.login('07700000001')).actor.personId;
    const before = swallowedVaultLogFailures();
    h.repo.failLogWrites = 1;
    await expect(h.service.displayNamesFor([actor.personId], staff, 'console_names')).rejects.toBeInstanceOf(VaultLogWriteError);
    expect(swallowedVaultLogFailures()).toBe(before);
    // With the log working again the same read answers.
    expect(await h.service.displayNamesFor([actor.personId], staff, 'console_names')).toEqual({ [actor.personId]: { displayName: 'حيدر ك.', deleted: false } });
  });
});
