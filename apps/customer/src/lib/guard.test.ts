import { describe, expect, it } from 'vitest';
import { resolveGuard } from './guard';

const g = (status: 'loading' | 'signedIn' | 'signedOut', segments: string[], setupPending = false) => resolveGuard({ status, segments, setupPending });

describe('route guard', () => {
  it('waits while the session loads', () => {
    expect(g('loading', [])).toBeNull();
    expect(g('loading', ['(tabs)'])).toBeNull();
  });

  it('sends signed-out people to welcome from anywhere outside auth', () => {
    expect(g('signedOut', [])).toBe('/welcome');
    expect(g('signedOut', ['(tabs)'])).toBe('/welcome');
    expect(g('signedOut', ['(tabs)', 'account'])).toBe('/welcome');
    expect(g('signedOut', ['order', '[id]'])).toBe('/welcome');
    expect(g('signedOut', ['restaurant', '[id]'])).toBe('/welcome');
  });

  it('lets signed-out people move through the auth screens', () => {
    expect(g('signedOut', ['(auth)', 'welcome'])).toBeNull();
    expect(g('signedOut', ['(auth)', 'phone'])).toBeNull();
    expect(g('signedOut', ['(auth)', 'otp'])).toBeNull();
  });

  it('keeps signed-out people off the post-OTP setup step', () => {
    expect(g('signedOut', ['(auth)', 'setup'])).toBe('/welcome');
  });

  it('takes a signed-in person out of auth to home', () => {
    expect(g('signedIn', ['(auth)', 'otp'])).toBe('/');
    expect(g('signedIn', ['(auth)', 'welcome'])).toBe('/');
  });

  it('routes to setup while it is pending, and only there', () => {
    expect(g('signedIn', ['(auth)', 'otp'], true)).toBe('/setup');
    expect(g('signedIn', ['(tabs)'], true)).toBe('/setup');
    expect(g('signedIn', ['(auth)', 'setup'], true)).toBeNull();
  });

  it('leaves signed-in people where they are', () => {
    expect(g('signedIn', ['(tabs)'])).toBeNull();
    expect(g('signedIn', ['(tabs)', 'orders'])).toBeNull();
    expect(g('signedIn', ['checkout'])).toBeNull();
    expect(g('signedIn', ['places', 'new'])).toBeNull();
  });
});
