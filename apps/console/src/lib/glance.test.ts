import { describe, expect, it } from 'vitest';
import { glanceVerdict } from './glance';

const counts = (sos: number, unassigned: number) => ({ byKind: { sos } as never, unassigned });

describe('glanceVerdict', () => {
  it('says nothing until both numbers are in', () => {
    expect(glanceVerdict(undefined, { lateOrders: 0 }, undefined)).toBeNull();
    expect(glanceVerdict(counts(0, 0), undefined, undefined)).toBeNull();
  });
  it('puts an open SOS first', () => {
    expect(glanceVerdict(counts(1, 4), { lateOrders: 3 }, { fallbackToAdmins: true })).toMatchObject({ tone: 'bad', key: 'console.glance.verdict_sos', n: 1 });
  });
  it('then nobody holding SOS', () => {
    expect(glanceVerdict(counts(0, 4), { lateOrders: 3 }, { fallbackToAdmins: true })).toMatchObject({ tone: 'bad', key: 'console.glance.verdict_nobody_sos' });
  });
  it('then late orders, then problems nobody took', () => {
    expect(glanceVerdict(counts(0, 4), { lateOrders: 3 }, { fallbackToAdmins: false })).toMatchObject({ tone: 'warn', key: 'console.glance.verdict_late', n: 3 });
    expect(glanceVerdict(counts(0, 4), { lateOrders: 0 }, undefined)).toMatchObject({ tone: 'warn', key: 'console.glance.verdict_unowned', n: 4 });
  });
  it('is calm when nothing needs anyone', () => {
    expect(glanceVerdict(counts(0, 0), { lateOrders: 0 }, undefined)).toMatchObject({ tone: 'ok', key: 'console.glance.verdict_calm' });
  });
});
