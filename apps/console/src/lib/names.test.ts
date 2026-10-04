import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orderTicketNumber, type ConsoleNames, type ConsoleNamesInput } from '@driver/contracts';
import { accountRef, isSystemActor, NameStore, orderLabel, personText } from './names';

const haider = { displayName: 'حيدر ك.', deleted: false, vehicleClass: 'tuktuk' as const, plate: 'واسط 45671' };

function fakeApi(answer: (input: ConsoleNamesInput) => ConsoleNames = () => ({ people: {}, orgs: {}, items: {} })) {
  const calls: ConsoleNamesInput[] = [];
  const fetcher = vi.fn(async (input: ConsoleNamesInput) => {
    calls.push(input);
    return answer(input);
  });
  return { calls, fetcher };
}

describe('NameStore: one batched call per moment (K-01)', () => {
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
  });
  afterEach(() => vi.useRealTimers());

  it('asks made together go out as one call, de-duplicated; system actors are never asked', async () => {
    const api = fakeApi((i) => ({
      people: Object.fromEntries((i.personIds ?? []).filter((id) => id === 'p_1').map((id) => [id, haider])),
      orgs: { org_7: { name: 'مطعم خالد', type: 'restaurant' } },
      items: { 'org_7:ci_57': { name: 'صحن معلاك' } },
    }));
    const store = new NameStore(api.fetcher, () => now);
    store.ask({ people: ['p_1', 'p_2', null, 'system', 'system:notify'] });
    store.ask({ people: ['p_1'], orgs: ['org_7'], items: [{ orgId: 'org_7', itemId: 'ci_57' }] });
    expect(store.person('p_1')).toBeUndefined();
    await vi.runAllTimersAsync();
    expect(api.calls).toEqual([{ personIds: ['p_1', 'p_2'], orgIds: ['org_7'], items: [{ orgId: 'org_7', itemId: 'ci_57' }] }]);
    expect(store.person('p_1')).toEqual(haider);
    expect(store.person('p_2')).toBeNull(); // known: no name → the id is shown
    expect(store.org('org_7')?.name).toBe('مطعم خالد');
    expect(store.item('org_7', 'ci_57')?.name).toBe('صحن معلاك');
  });

  it('answers are kept ten minutes; asking again inside that window sends nothing', async () => {
    const api = fakeApi();
    const store = new NameStore(api.fetcher, () => now);
    store.ask({ people: ['p_1'] });
    await vi.runAllTimersAsync();
    store.ask({ people: ['p_1'] });
    await vi.runAllTimersAsync();
    expect(api.calls).toHaveLength(1);
    now += 10 * 60_000 + 1;
    store.ask({ people: ['p_1'] });
    await vi.runAllTimersAsync();
    expect(api.calls).toHaveLength(2);
  });

  it('a failed call shows ids and asks again after 30 s', async () => {
    let fail = true;
    const api = fakeApi(() => {
      if (fail) throw new Error('offline');
      return { people: { p_1: haider }, orgs: {}, items: {} };
    });
    const store = new NameStore(api.fetcher, () => now);
    store.ask({ people: ['p_1'] });
    await vi.runAllTimersAsync();
    expect(store.person('p_1')).toBeNull();
    fail = false;
    store.ask({ people: ['p_1'] });
    await vi.runAllTimersAsync();
    expect(api.calls).toHaveLength(1);
    now += 30_001;
    store.ask({ people: ['p_1'] });
    await vi.runAllTimersAsync();
    expect(store.person('p_1')).toEqual(haider);
  });

  it('a big page is split at the API cap (200 per kind)', async () => {
    const api = fakeApi();
    const store = new NameStore(api.fetcher, () => now);
    store.ask({ people: Array.from({ length: 450 }, (_, i) => `p_${i}`) });
    await vi.runAllTimersAsync();
    expect(api.calls.map((c) => c.personIds?.length)).toEqual([200, 200, 50]);
  });

  it('clear() forgets everything (sign-out)', async () => {
    const api = fakeApi(() => ({ people: { p_1: haider }, orgs: {}, items: {} }));
    const store = new NameStore(api.fetcher, () => now);
    store.ask({ people: ['p_1'] });
    await vi.runAllTimersAsync();
    store.clear();
    expect(store.person('p_1')).toBeUndefined();
  });
});

describe('labels', () => {
  it('person: name, with vehicle and plate for drivers (live class wins), deleted, system, none', () => {
    expect(personText('p_1', haider)).toBe('حيدر ك.');
    expect(personText('p_1', haider, { vehicle: true })).toBe('حيدر ك. · تكتك · واسط 45671');
    expect(personText('p_1', { ...haider, plate: null }, { vehicle: true, vehicleClass: 'bike' })).toBe('حيدر ك. · ماطور');
    expect(personText('p_1', { ...haider, displayName: null, deleted: true })).toBe('حساب محذوف');
    expect(personText('p_1', { ...haider, displayName: null })).toBeNull();
    expect(personText('p_1', undefined)).toBeNull();
    expect(personText('system', undefined)).toBe('النظام');
    expect(isSystemActor('system:notify')).toBe(true);
    expect(isSystemActor('p_system')).toBe(false);
  });

  it('order: "#" + the ticket number every app shows, isolated left-to-right inside Arabic text', () => {
    expect(orderLabel('ord_969')).toBe(`⁦#${orderTicketNumber('ord_969')}⁩`);
  });

  it('ledger accounts: people, restaurants and fixed words; anything else as written', () => {
    expect(accountRef('cash:p_7')).toEqual({ kind: 'person', id: 'p_7' });
    expect(accountRef('customer:p_9')).toEqual({ kind: 'person', id: 'p_9' });
    expect(accountRef('merchant_cash:org_7')).toEqual({ kind: 'org', id: 'org_7' });
    expect(accountRef('bank')).toEqual({ label: 'صندوق الشركة' });
    expect(accountRef('promo:pr_1')).toBeNull();
    expect(accountRef('cash:')).toBeNull();
  });
});
