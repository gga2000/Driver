import { describe, expect, it } from 'vitest';
import { readiness, type ReadyInputs } from './readiness';

const OK: ReadyInputs = { gps: 'on', net: 'online', sound: 'ready', push: 'granted', battery: { level: 0.64, charging: false } };

describe('readiness row (S-8)', () => {
  it('all green: four items, no issues, battery as a percent', () => {
    const r = readiness(OK);
    expect(r.issues).toBe(0);
    expect(r.items.map((x) => [x.key, x.tone])).toEqual([
      ['gps', 'ok'],
      ['net', 'ok'],
      ['sound', 'ok'],
      ['battery', 'ok'],
    ]);
    expect(r.items[3]!.percent).toBe(64);
  });

  it('each problem explains itself and links to its fix', () => {
    const r = readiness({ gps: 'off', net: 'offline', sound: 'blocked', push: 'denied', battery: { level: 0.12, charging: false } });
    expect(r.issues).toBe(4);
    expect(r.items.map((x) => [x.key, x.tone, x.problem, x.fix])).toEqual([
      ['gps', 'bad', 'partner.ready_gps_off', 'settings'],
      ['net', 'bad', 'partner.ready_net_off', 'retry'],
      ['sound', 'bad', 'partner.ready_sound_off', 'sound'],
      ['battery', 'bad', 'partner.ready_battery_low', null],
    ]);
  });

  it('location not allowed yet asks; push off on a phone is the sound item; charging is never low', () => {
    expect(readiness({ ...OK, gps: 'ask' }).items[0]).toMatchObject({ tone: 'warn', problem: 'partner.ready_gps_ask', fix: 'gps' });
    expect(readiness({ ...OK, push: 'denied' }).items[2]).toMatchObject({ tone: 'bad', problem: 'partner.ready_push_off', fix: 'settings' });
    expect(readiness({ ...OK, battery: { level: 0.25, charging: false } }).items[3]).toMatchObject({ tone: 'warn', percent: 25 });
    expect(readiness({ ...OK, battery: { level: 0.05, charging: true } }).items[3]).toMatchObject({ tone: 'ok' });
    // Web without the Battery API: the chip is hidden, not guessed.
    expect(readiness({ ...OK, battery: null, push: 'n/a' }).items.map((x) => x.key)).toEqual(['gps', 'net', 'sound']);
    // A sound still loading is not an alarm.
    expect(readiness({ ...OK, sound: 'unknown' }).issues).toBe(0);
  });
});
