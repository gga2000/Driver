import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from './storage';
import { buildDecides, createScreenSwitches, parseScreens, SCREENS_KEY, uiSwitchOn } from './ui-switches';

describe('uiSwitchOn', () => {
  it('follows the build when nothing is listed: on in studio builds, off in store builds', () => {
    expect(uiSwitchOn('basket_v2', undefined, true)).toBe(true);
    expect(uiSwitchOn('basket_v2', '', false)).toBe(false);
  });
  it('turns on only the listed screens', () => {
    expect(uiSwitchOn('basket_v2', 'basket_v2, checkout_v2', false)).toBe(true);
    expect(uiSwitchOn('track_v2', 'basket_v2,checkout_v2', true)).toBe(false);
    expect(uiSwitchOn('orders_v2', 'all', false)).toBe(true);
  });
  it('none keeps every old screen, even in the studio', () => {
    expect(uiSwitchOn('basket_v2', 'none', true)).toBe(false);
  });
});

describe('screen switches from the server (system.screens)', () => {
  const off = { basket_v2: false, checkout_v2: false, track_v2: false, orders_v2: false };
  const make = (seed: Record<string, string> = {}, fromBuild = false) => {
    const storage = createMemoryStorage(seed);
    return { storage, sw: createScreenSwitches({ storage, fromBuild, buildOn: (n) => n === 'basket_v2' }) };
  };

  it('shows the old screens when nothing was read and nothing was saved', async () => {
    const { sw } = make();
    await sw.loadSaved();
    expect(sw.read('orders_v2')).toBe(false);
  });

  it("uses the server's answer and saves it for the next start", async () => {
    const { sw, storage } = make();
    await sw.apply({ ...off, orders_v2: true });
    expect(sw.read('orders_v2')).toBe(true);
    expect(JSON.parse(storage.dump()[SCREENS_KEY]!)).toEqual({ ...off, orders_v2: true });
  });

  it("lets the last start's answer stand in until the new one arrives", async () => {
    const { sw } = make({ [SCREENS_KEY]: JSON.stringify({ ...off, track_v2: true }) });
    await sw.loadSaved();
    expect(sw.read('track_v2')).toBe(true);
  });

  it('never flips a screen already read in this start', async () => {
    const { sw } = make();
    expect(sw.read('checkout_v2')).toBe(false);
    await sw.apply({ ...off, checkout_v2: true, basket_v2: true });
    expect(sw.read('checkout_v2')).toBe(false);
    // A switch no screen read yet takes the new answer.
    expect(sw.read('basket_v2')).toBe(true);
  });

  it('a fresh answer wins over a saved one read later', async () => {
    const { sw } = make({ [SCREENS_KEY]: JSON.stringify({ ...off, orders_v2: true }) });
    await sw.apply(off);
    await sw.loadSaved();
    expect(sw.read('orders_v2')).toBe(false);
  });

  it('ignores a broken answer or a broken saved copy', async () => {
    const { sw } = make({ [SCREENS_KEY]: '{not json' });
    await sw.loadSaved();
    await sw.apply({ orders_v2: 'yes' });
    expect(parseScreens({ orders_v2: true })).toBeNull();
    expect(sw.read('orders_v2')).toBe(false);
  });

  it('the studio build decides by itself and never saves', async () => {
    const { sw, storage } = make({}, true);
    await sw.apply({ ...off, orders_v2: true });
    expect(sw.read('orders_v2')).toBe(false);
    expect(sw.read('basket_v2')).toBe(true);
    expect(storage.dump()).toEqual({});
    expect(buildDecides(undefined, true)).toBe(true);
    expect(buildDecides('', false)).toBe(false);
    expect(buildDecides('none', false)).toBe(true);
  });
});
