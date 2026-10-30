import { describe, expect, it } from 'vitest';
import type { Actor } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { createInMemoryEvents } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import { InMemoryHandoverRepository } from './handover.repository.js';
import { HandoverService } from './handover.service.js';

const staff = (personId: string): Actor => ({ personId, roles: ['support'] }) as unknown as Actor;

function setup() {
  const clock = new FakeClock('2026-10-09T05:30:00Z');
  const ev = createInMemoryEvents({ clock });
  const controls = new InMemoryControlsRepository();
  const identity = { displayNames: async () => ({}) } as unknown as IdentityService;
  const audits = new AuditLogService(controls, new StaffNames(identity, clock), clock);
  const svc = new HandoverService(new InMemoryHandoverRepository(), audits, ev.uow, clock);
  return { clock, controls, svc };
}

describe('shift handover note (h5)', () => {
  it('the next shift sees the newest note until each person taps «وصلت»', async () => {
    const { svc } = setup();
    const night = staff('p_night');
    const morning = staff('p_morning');
    expect(await svc.latest(morning, { cityId: 'aziziyah' })).toBeNull();
    const written = await svc.write(night, { cityId: 'aziziyah', body: 'مطعم خالد طابعته عاطلة، اتصلوا بيه' });
    expect(written).toMatchObject({ mine: true, ackedByMe: true, acks: 1 });
    const seen = await svc.latest(morning, { cityId: 'aziziyah' });
    expect(seen).toMatchObject({ body: 'مطعم خالد طابعته عاطلة، اتصلوا بيه', mine: false, ackedByMe: false, acks: 1 });
    const acked = await svc.ack(morning, { id: written.id });
    expect(acked).toMatchObject({ ackedByMe: true, acks: 2 });
    // A second tap changes nothing.
    expect(await svc.ack(morning, { id: written.id })).toMatchObject({ acks: 2 });
  });

  it('writing is audited; an old note stops showing after 16 hours', async () => {
    const { svc, clock, controls } = setup();
    await svc.write(staff('p_night'), { cityId: 'aziziyah', body: 'ماكو شي' });
    const audit = await controls.audit({ cityId: 'aziziyah', subjectKind: 'handover_note', limit: 5 });
    expect(audit.map((a) => a.action)).toEqual(['handover.written']);
    clock.advance(16 * 3_600_000 + 1_000);
    expect(await svc.latest(staff('p_morning'), { cityId: 'aziziyah' })).toBeNull();
  });

  it('an unknown note is not found', async () => {
    const { svc } = setup();
    await expect(svc.ack(staff('p'), { id: 'hnd_nope' })).rejects.toThrow();
  });
});
