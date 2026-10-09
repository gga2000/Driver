import { describe, expect, it } from 'vitest';
import type { StaffMember } from '@driver/contracts';
import { translate } from '@/lib/i18n-core';
import { invitePhone, isLastOwner, resendWaitMinutes, roleKey, splitStaff } from './logic';

const m = (personId: string, role: StaffMember['role'], over: Partial<StaffMember> = {}): StaffMember => ({ personId, name: personId, phoneMasked: null, role, you: false, pending: false, ...over });

describe('staff', () => {
  it('team puts you first, then owners, then staff; invites wait apart', () => {
    const { team, pending } = splitStaff([m('زينب', 'merchant_staff'), m('حسين', 'merchant_staff', { pending: true }), m('أبو علي', 'merchant_owner'), m('خالد', 'merchant_owner', { you: true })]);
    expect(team.map((s) => s.personId)).toEqual(['خالد', 'أبو علي', 'زينب']);
    expect(pending.map((s) => s.personId)).toEqual(['حسين']);
  });

  it('the last owner stays', () => {
    const list = [m('a', 'merchant_owner'), m('b', 'merchant_staff')];
    expect(isLastOwner(list, 'a')).toBe(true);
    expect(isLastOwner(list, 'b')).toBe(false);
    expect(isLastOwner([...list, m('c', 'merchant_owner')], 'a')).toBe(false);
    expect(roleKey('merchant_owner')).toBe('merchant.staff.role_owner');
  });

  it('a waiting invite reads "دعوة مرسلة إلى 0770 ••• 1234" and can be resent after the cooldown', () => {
    const now = Date.parse('2026-10-04T10:00:00Z');
    const invite = m('p', 'merchant_staff', {
      name: null,
      pending: true,
      phoneHint: '0770 ••• 1234',
      phoneMasked: '+96477*****34',
      resendAfter: new Date(now + 4.2 * 60_000),
    });
    expect(translate('merchant.staff.invite_to', { phone: invitePhone(invite)! }, 'ar-IQ')).toBe(
      'دعوة مرسلة إلى \u20660770\u00A0•••\u00A01234\u2069',
    );
    expect(invitePhone({ phoneHint: null, phoneMasked: '+96477*****34' })).toBe(
      '\u2066077•\u00A0•••\u00A0••34\u2069',
    );
    expect(invitePhone({ phoneHint: null, phoneMasked: null })).toBeNull();
    expect(resendWaitMinutes(invite, now)).toBe(5);
    expect(resendWaitMinutes(invite, now + 10 * 60_000)).toBe(0);
    expect(resendWaitMinutes({ resendAfter: null }, now)).toBe(0);
  });
});
