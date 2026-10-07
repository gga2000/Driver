import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { harness } from './test-harness.js';

/** Ride ideas c9/s3: the person a booker books a ride for, and the name he gave them, in the vault. */
describe('identity: the rider of a ride booked for someone else', () => {
  it('a number is a person: the same one each time, an account when the number has one', async () => {
    const h = harness();
    const { actor: booker } = await h.login('07712345678');
    const a = await h.service.riderByPhone('0770 555 4433', booker.personId);
    const b = await h.service.riderByPhone('+9647705554433', booker.personId);
    expect(a.personId).toBe(b.personId);
    expect(a.phoneHash).toBe(b.phoneHash);
    expect(a.phoneHash).not.toContain('7705554433');
    // Someone with the app is found by their number.
    const { actor: sister } = await h.login('07801112233');
    expect((await h.service.riderByPhone('0780 111 2233', booker.personId)).personId).toBe(sister.personId);
    expect(await code(h.service.riderByPhone('12345', booker.personId))).toBe('phone_invalid');
  });

  it('keeps the name the booker gave; reads are logged against the rider, not for the rider himself', async () => {
    const h = harness();
    const { actor: booker } = await h.login('07712345678');
    const rider = await h.service.riderByPhone('07705554433', booker.personId);
    await h.service.rememberParticipantName({ participantId: 'part_1', personId: rider.personId, givenById: booker.personId, name: '  ماما  ' });
    expect(await h.service.participantNames(['part_1', 'part_missing'], booker.personId, 'ride_rider_name')).toEqual({ part_1: 'ماما' });
    expect(await h.service.participantNames(['part_1'], 'drv_1', 'partner_rider')).toEqual({ part_1: 'ماما' });
    await h.service.participantNames(['part_1'], rider.personId, 'ride_rider_name');
    const logs = (await h.repo.vaultAccessLogs(rider.personId)).filter((l) => l.fieldsRead.includes('participant_name'));
    expect(logs.map((l) => [l.accessorId, l.purpose])).toEqual([
      [booker.personId, 'ride_rider_name'],
      ['drv_1', 'partner_rider'],
    ]);
    // Nothing personal leaves the vault through events.
    expect(JSON.stringify(h.events.events)).not.toMatch(/7705554433|ماما/);
  });

  it('an empty name is refused; a long one is cut to 40 characters', async () => {
    const h = harness();
    const { actor: booker } = await h.login('07712345678');
    const rider = await h.service.riderByPhone('07705554433', booker.personId);
    expect(await code(h.service.rememberParticipantName({ participantId: 'part_1', personId: rider.personId, givenById: booker.personId, name: '   ' }))).toBe('invalid_input');
    await h.service.rememberParticipantName({ participantId: 'part_2', personId: rider.personId, givenById: booker.personId, name: 'ا'.repeat(60) });
    expect((await h.service.participantNames(['part_2'], booker.personId, 'ride_rider_name'))['part_2']).toHaveLength(40);
  });
});

async function code(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DriverError);
  return (err as DriverError).code;
}
