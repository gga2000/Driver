import { describe, expect, it } from 'vitest';
import type { FleetDriver } from '@driver/contracts';
import { createT } from '@driver/i18n';
import { inviteNames, phoneHintText, splitFleetDrivers, splitInvites } from './logic';

const t = createT('ar-IQ');

function driver(patch: Partial<FleetDriver> & { driverId: string }): FleetDriver {
  return {
    name: null,
    phoneMasked: null,
    state: 'offline',
    vehicleId: null,
    tier: 'bronze',
    todayEarningsIqd: 0,
    weekEarningsIqd: 0,
    owedIqd: 0,
    cashHeldIqd: 0,
    capIqd: 0,
    documents: null,
    pending: false,
    ...patch,
  };
}

describe('fleet invites (consent)', () => {
  it('the owner sees accepted drivers sorted as before, and waiting invites apart, newest first', () => {
    const { active, pending } = splitFleetDrivers([
      driver({
        driverId: 'p1',
        pending: true,
        phoneHint: '0770 ••• 1111',
        invitedAt: new Date('2026-10-01T10:00:00Z'),
      }),
      driver({ driverId: 'a1', name: 'زيد', state: 'offline' }),
      driver({ driverId: 'a2', name: 'حسين', state: 'on_job', todayEarningsIqd: 9000 }),
      driver({
        driverId: 'p2',
        pending: true,
        phoneHint: null,
        invitedAt: new Date('2026-10-03T10:00:00Z'),
      }),
    ]);
    expect(active.map((d) => d.driverId)).toEqual(['a2', 'a1']);
    expect(pending.map((d) => d.driverId)).toEqual(['p2', 'p1']);
    expect(t('partner.fleet_pending_row', { phone: phoneHintText('0770 ••• 1111')! })).toBe(
      'دعوة مرسلة إلى ⁦0770 ••• 1111⁩',
    );
    expect(phoneHintText(null)).toBeNull();
  });

  it("the driver's card names the owner and the fleet, with neutral fallbacks", () => {
    const at = new Date('2026-10-04T08:00:00Z');
    const invite = {
      fleetOrgId: 'f1',
      invitedAt: at,
      invitedByName: 'سجاد',
      fleetName: 'أسطول الربيعي',
      accepted: false,
    };
    const n = inviteNames(invite, t);
    expect(t('partner.fleet_invite_title', { owner: n.owner, fleet: n.fleet })).toBe(
      'سجاد يريد يضيفك على أسطول الربيعي',
    );
    expect(inviteNames({ invitedByName: null, fleetName: null }, t)).toEqual({
      owner: 'صاحب الأسطول',
      fleet: 'أسطول',
      ownerKnown: false,
    });
    const { pending, member } = splitInvites([
      invite,
      { ...invite, fleetOrgId: 'f2', accepted: true },
    ]);
    expect(pending.map((i) => i.fleetOrgId)).toEqual(['f1']);
    expect(member.map((i) => i.fleetOrgId)).toEqual(['f2']);
  });
});
