import { describe, expect, it } from 'vitest';
import { resolveGuard, returnSpent, signInReason, type GuardInput } from './guard';

type Status = 'loading' | 'signedIn' | 'signedOut';
const g = (status: Status, segments: string[], setupPending = false, extra: Partial<GuardInput> = {}) => resolveGuard({ status, segments, setupPending, welcomed: true, ...extra });
const to = (status: Status, segments: string[], setupPending = false, extra: Partial<GuardInput> = {}) => g(status, segments, setupPending, extra)?.to ?? null;

describe('route guard', () => {
  it('waits while the session loads', () => {
    expect(g('loading', [])).toBeNull();
    expect(g('loading', ['(tabs)'])).toBeNull();
  });

  it('shows welcome once on a first launch, then lets the guest browse home', () => {
    expect(to('signedOut', [], false, { welcomed: false })).toBe('/welcome');
    expect(to('signedOut', ['(tabs)'], false, { welcomed: false })).toBe('/welcome');
    expect(g('signedOut', [], false, { welcomed: true })).toBeNull();
    expect(g('signedOut', ['(tabs)'])).toBeNull();
    // A deep link to a menu opens it even before welcome.
    expect(g('signedOut', ['restaurant', '[id]'], false, { welcomed: false })).toBeNull();
  });

  it('lets guests browse home, search, the restaurant list, menus, the cart and the tabs (C-18)', () => {
    for (const segs of [['(tabs)'], ['(tabs)', 'orders'], ['(tabs)', 'account'], ['search'], ['restaurants'], ['restaurant', '[id]'], ['cart']]) {
      expect(g('signedOut', segs), segs.join('/')).toBeNull();
    }
  });

  it('asks a guest for the phone at protected screens and remembers where they were going', () => {
    expect(g('signedOut', ['checkout'], false, { pathname: '/checkout' })).toEqual({ to: '/phone', remember: '/checkout' });
    expect(g('signedOut', ['rajaa', 'departure', '[id]'], false, { pathname: '/rajaa/departure/d1' })).toEqual({ to: '/phone', remember: '/rajaa/departure/d1' });
    expect(g('signedOut', ['order', '[id]'], false, { pathname: '/order/o1' })).toEqual({ to: '/phone', remember: '/order/o1' });
    expect(to('signedOut', ['ride'])).toBe('/phone');
    expect(to('signedOut', ['places'])).toBe('/phone');
    // The chat is not public.
    expect(to('signedOut', ['chat', '[orderId]'])).toBe('/phone');
  });

  it('lets signed-out people move through the auth screens', () => {
    expect(g('signedOut', ['(auth)', 'welcome'])).toBeNull();
    expect(g('signedOut', ['(auth)', 'phone'])).toBeNull();
    expect(g('signedOut', ['(auth)', 'otp'])).toBeNull();
  });

  it('keeps signed-out people off the post-OTP setup step', () => {
    expect(to('signedOut', ['(auth)', 'setup'])).toBe('/welcome');
  });

  it('takes a signed-in person out of auth to home, or back to where the guest was going', () => {
    expect(g('signedIn', ['(auth)', 'otp'])).toEqual({ to: '/' });
    expect(g('signedIn', ['(auth)', 'welcome'])).toEqual({ to: '/' });
    expect(g('signedIn', ['(auth)', 'otp'], false, { returnTo: '/checkout' })).toEqual({ to: '/checkout' });
    // After setup (a new account), the same return.
    expect(g('signedIn', ['(auth)', 'setup'], false, { returnTo: '/rajaa/departure/d1' })).toEqual({ to: '/rajaa/departure/d1' });
  });

  it('spends the return path only once the person has landed outside auth', () => {
    const r = (status: Status, segments: string[], setupPending = false) => returnSpent({ status, segments, setupPending, returnTo: '/checkout' });
    expect(r('signedIn', ['checkout'])).toBe(true);
    expect(r('signedIn', ['(auth)', 'otp'])).toBe(false);
    expect(r('signedIn', ['(auth)', 'setup'], true)).toBe(false);
    expect(r('signedOut', ['cart'])).toBe(false);
    expect(returnSpent({ status: 'signedIn', segments: ['checkout'], setupPending: false, returnTo: null })).toBe(false);
  });

  it('routes to setup while it is pending, and only there (the return waits for it)', () => {
    expect(to('signedIn', ['(auth)', 'otp'], true, { returnTo: '/checkout' })).toBe('/setup');
    expect(to('signedIn', ['(tabs)'], true)).toBe('/setup');
    expect(g('signedIn', ['(auth)', 'setup'], true)).toBeNull();
  });

  it('leaves signed-in people where they are', () => {
    expect(g('signedIn', ['(tabs)'])).toBeNull();
    expect(g('signedIn', ['(tabs)', 'orders'])).toBeNull();
    expect(g('signedIn', ['checkout'], false, { returnTo: '/checkout' })).toBeNull();
    expect(g('signedIn', ['places', 'new'])).toBeNull();
  });

  it('opens the share-trip page for anyone (signed out, signed in, mid-setup)', () => {
    expect(g('signedOut', ['share', '[token]'], false, { welcomed: false })).toBeNull();
    expect(g('signedIn', ['share', '[token]'])).toBeNull();
    expect(g('signedIn', ['share', '[token]'], true)).toBeNull();
  });

  it('tells the phone screen why the number is asked', () => {
    expect(signInReason('/checkout')).toBe('order');
    expect(signInReason('/rajaa/departure/d1')).toBe('book');
    expect(signInReason('/ride')).toBe('book');
    expect(signInReason('/orders')).toBeNull();
    expect(signInReason(null)).toBeNull();
  });
});
