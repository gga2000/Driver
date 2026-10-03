import { describe, expect, it } from 'vitest';
import type { StaffMember } from '@driver/contracts';
import { isLastOwner, roleKey, splitStaff } from './logic';

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
});
