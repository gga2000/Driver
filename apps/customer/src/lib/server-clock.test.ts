import { describe, expect, it } from 'vitest';
import { ServerClock, withServerClock } from './server-clock';

const at = (iso: string) => Date.parse(iso);

describe('ServerClock', () => {
  it('is the phone clock before any answer', () => {
    const c = new ServerClock();
    expect(c.offsetMs()).toBe(0);
    expect(c.now(1_000).getTime()).toBe(1_000);
  });

  it('learns a phone that runs five minutes fast', () => {
    const c = new ServerClock();
    const sent = at('2027-03-01T15:05:00.000Z');
    c.note('Mon, 01 Mar 2027 15:00:00 GMT', sent, sent + 200);
    // Server moment 15:00:00.5 against the phone's midpoint 15:05:00.1.
    expect(c.offsetMs()).toBe(-299_600);
    expect(c.now(sent).toISOString()).toBe('2027-03-01T15:00:00.400Z');
  });

  it('ignores a gap under two seconds, a missing header and garbage', () => {
    const c = new ServerClock();
    const sent = at('2027-03-01T15:00:00.000Z');
    c.note('Mon, 01 Mar 2027 15:00:01 GMT', sent, sent + 100);
    expect(c.offsetMs()).toBe(0);
    c.note(null, sent, sent + 10);
    c.note('not a date', sent, sent + 10);
    expect(c.offsetMs()).toBe(0);
  });

  it('keeps the quickest round trip, and lets any answer replace it after ten minutes', () => {
    const c = new ServerClock();
    const t0 = at('2027-03-01T15:05:00.000Z');
    c.note('Mon, 01 Mar 2027 15:00:00 GMT', t0, t0 + 100);
    const first = c.offsetMs();
    c.note('Mon, 01 Mar 2027 15:10:00 GMT', t0 + 1_000, t0 + 9_000);
    expect(c.offsetMs()).toBe(first);
    const later = t0 + 11 * 60_000;
    c.note('Mon, 01 Mar 2027 15:11:00 GMT', later, later + 3_000);
    expect(c.offsetMs()).toBe(at('2027-03-01T15:11:00.500Z') - (later + 1_500));
  });
});

describe('withServerClock', () => {
  it('reads the Date header of each answer and passes the answer on', async () => {
    const c = new ServerClock();
    const res = new Response('ok', { headers: { date: new Date(Date.now() - 600_000).toUTCString() } });
    const f = withServerClock(async () => res, c);
    expect(await f('http://x')).toBe(res);
    expect(c.offsetMs()).toBeLessThan(-590_000);
  });
});
