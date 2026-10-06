import { describe, expect, it } from 'vitest';
import { harness } from './test-harness.js';

/**
 * The referral fingerprint's identity side (decisions §1, joy g2): two accounts signed in on the same
 * phone handset share a device mark; their phone hashes differ; nothing raw leaves identity.
 */
describe('identity.referralMarks', () => {
  it('two accounts on one handset share a device mark, never a raw fingerprint or number', async () => {
    const h = harness();
    const ali = await h.login('07701234567', { fingerprint: 'handset-1', platform: 'android' });
    const zaid = await h.login('07709876543', { fingerprint: 'handset-1', platform: 'android' });
    const sara = await h.login('07801112233', { fingerprint: 'handset-2', platform: 'android' });
    const [a, z, s] = await Promise.all([h.service.referralMarks(ali.actor.personId), h.service.referralMarks(zaid.actor.personId), h.service.referralMarks(sara.actor.personId)]);
    expect(a.deviceMarks).toEqual(z.deviceMarks);
    expect(a.deviceMarks).not.toEqual(s.deviceMarks);
    expect(a.phoneHash).not.toBe(z.phoneHash);
    const all = JSON.stringify([a, z, s]);
    expect(all).not.toContain('handset');
    expect(all).not.toContain('7701234567');
  });

  it('peppered marks are stable and one-way', async () => {
    const h = harness();
    expect(h.service.pepperedMark('home:00:1:2')).toBe(h.service.pepperedMark('home:00:1:2'));
    expect(h.service.pepperedMark('home:00:1:2')).not.toContain('home');
  });
});
