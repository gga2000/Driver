import { describe, expect, it } from 'vitest';
import { isSectionRoot, pickStore, resolveGuard, sectionOf } from './guard';

describe('route guard', () => {
  it('signed out: everything but the auth group goes to /welcome', () => {
    expect(resolveGuard({ status: 'signedOut', access: 'loading', segments: [] })).toBe('/welcome');
    expect(resolveGuard({ status: 'signedOut', access: 'ready', segments: ['menu'] })).toBe('/welcome');
    expect(resolveGuard({ status: 'signedOut', access: 'loading', segments: ['(auth)', 'otp'] })).toBeNull();
    expect(resolveGuard({ status: 'loading', access: 'loading', segments: [] })).toBeNull();
  });

  it('signed in: waits for stores, then gate, picker or board', () => {
    expect(resolveGuard({ status: 'signedIn', access: 'loading', segments: ['(auth)', 'otp'] })).toBeNull();
    expect(resolveGuard({ status: 'signedIn', access: 'none', segments: ['(auth)', 'otp'] })).toBe('/not-activated');
    expect(resolveGuard({ status: 'signedIn', access: 'none', segments: ['not-activated'] })).toBeNull();
    expect(resolveGuard({ status: 'signedIn', access: 'pick', segments: [] })).toBe('/stores');
    expect(resolveGuard({ status: 'signedIn', access: 'pick', segments: ['stores'] })).toBeNull();
    expect(resolveGuard({ status: 'signedIn', access: 'ready', segments: ['(auth)', 'otp'] })).toBe('/');
    expect(resolveGuard({ status: 'signedIn', access: 'ready', segments: ['not-activated'] })).toBe('/');
    expect(resolveGuard({ status: 'signedIn', access: 'ready', segments: ['stores'] })).toBeNull(); // switching store
    expect(resolveGuard({ status: 'signedIn', access: 'ready', segments: ['menu'] })).toBeNull();
  });
});

describe('store pick', () => {
  const a = { orgId: 'a' };
  const b = { orgId: 'b' };
  it('remembered store if still mine, the only one, else ask', () => {
    expect(pickStore(undefined, null)).toEqual({ access: 'loading', store: null });
    expect(pickStore([], 'a')).toEqual({ access: 'none', store: null });
    expect(pickStore([a], null)).toEqual({ access: 'ready', store: a });
    expect(pickStore([a, b], 'b')).toEqual({ access: 'ready', store: b });
    expect(pickStore([a, b], 'gone')).toEqual({ access: 'pick', store: null });
    expect(pickStore([a, b], null)).toEqual({ access: 'pick', store: null });
  });
});

describe('sections', () => {
  it('maps routes to the rail/tab sections', () => {
    expect(sectionOf([])).toBe('orders');
    expect(sectionOf(['menu', 'item'])).toBe('menu');
    expect(sectionOf(['money'])).toBe('money');
    expect(sectionOf(['insights'])).toBe('money');
    for (const s of ['more', 'deals', 'staff', 'printer', 'hours', 'pickup-spot', 'delivery-area', 'menu-photos', 'story', 'settings']) expect(sectionOf([s])).toBe('more');
    expect(sectionOf(['pot'])).toBe('menu');
    expect(sectionOf(['(auth)', 'welcome'])).toBeNull();
    expect(sectionOf(['stores'])).toBeNull();
  });
  it('only section roots keep the phone bottom bar', () => {
    expect(isSectionRoot([])).toBe(true);
    expect(isSectionRoot(['menu'])).toBe(true);
    expect(isSectionRoot(['menu', 'index'])).toBe(true);
    expect(isSectionRoot(['menu', 'item'])).toBe(false);
    expect(isSectionRoot(['printer'])).toBe(false);
    expect(isSectionRoot(['delivery-area'])).toBe(false); // a screen under المزيد: back button, no tab bar
  });
});
