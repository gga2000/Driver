import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import { kitchenProgressLabel, kitchenStageLabel, kitchenStages, showKitchenProgress, type KitchenOrder } from './kitchen-progress';

const t = createT('ar-IQ');
const at = (m: number) => new Date(Date.parse('2026-10-07T15:00:00Z') + m * 60_000);
const clock = (d: Date) => `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
const order = (o: Partial<KitchenOrder> = {}): KitchenOrder => ({ type: 'food', state: 'merchant_accepted', acceptedAt: at(0), preparingAt: null, readyAt: null, pickedUpAt: null, ...o });
const states = (o: KitchenOrder) => kitchenStages(o)?.map((s) => `${s.key}:${s.state}`);

describe('kitchen progress from real events (joy l3)', () => {
  it('no story for rides, before the kitchen says yes, or once the order ended', () => {
    expect(kitchenStages(order({ type: 'ride' }))).toBeNull();
    expect(kitchenStages(order({ state: 'placed', acceptedAt: null }))).toBeNull();
    expect(kitchenStages(order({ state: 'customer_cancelled' }))).toBeNull();
    expect(kitchenStages(order({ type: 'grocery_catalog' }))).not.toBeNull();
  });

  it('accepted only: the yes is done, cooking waits for the kitchen to press it', () => {
    expect(states(order())).toEqual(['accepted:done', 'cooking:todo', 'ready:todo', 'picked_up:todo']);
  });

  it('cooking is active only from the kitchen’s own "started" event', () => {
    const s = kitchenStages(order({ state: 'preparing', preparingAt: at(2) }))!;
    expect(s.map((x) => x.state)).toEqual(['done', 'active', 'todo', 'todo']);
    expect(s[1]!.at).toEqual(at(2));
  });

  it('ready without "started": cooking counts as done, with no time to show', () => {
    const s = kitchenStages(order({ state: 'ready', readyAt: at(15) }))!;
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'done', 'todo']);
    expect(s[1]!.at).toBeNull();
    expect(s[2]!.at).toEqual(at(15));
  });

  it('picked up: every stage done', () => {
    expect(states(order({ state: 'picked_up', preparingAt: at(2), readyAt: at(15), pickedUpAt: at(18) }))).toEqual(['accepted:done', 'cooking:done', 'ready:done', 'picked_up:done']);
  });

  it('nothing moves with time alone: the same order read later gives the same stages', () => {
    const o = order({ state: 'preparing', preparingAt: at(2) });
    expect(kitchenStages(o)).toEqual(kitchenStages({ ...o }));
  });

  it('shows from the yes until pickup, in the kitchen phases only', () => {
    expect(showKitchenProgress(order({ state: 'preparing', preparingAt: at(2) }), 'preparing')).toBe(true);
    expect(showKitchenProgress(order({ state: 'ready', readyAt: at(9) }), 'at_pickup')).toBe(true);
    expect(showKitchenProgress(order({ state: 'picked_up', pickedUpAt: at(18) }), 'on_the_way')).toBe(false);
    expect(showKitchenProgress(order({ state: 'placed', acceptedAt: null }), 'waiting_merchant')).toBe(false);
    expect(showKitchenProgress(order(), null)).toBe(false);
  });

  it('labels name the courier once he is known', () => {
    expect(kitchenStageLabel('accepted', t, null)).toBe('المطعم قبل');
    expect(kitchenStageLabel('picked_up', t, 'حيدر')).toBe('استلمه حيدر');
    expect(kitchenStageLabel('picked_up', t, null)).toBe('استلمه الدليفري');
  });

  it('one sentence for screen readers, with the real times', () => {
    const s = kitchenStages(order({ state: 'preparing', preparingAt: at(2) }))!;
    expect(kitchenProgressLabel(s, t, clock, 'حيدر')).toBe('المطعم قبل 15:00، يطبخون من 15:02، جاهز: بعده، استلمه حيدر: بعده');
  });
});
