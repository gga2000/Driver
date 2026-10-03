import { describe, expect, it } from 'vitest';
import { resolveGuard } from './guard';

describe('partner route guard', () => {
  it('waits while the session loads', () => {
    expect(resolveGuard({ status: 'loading', gate: 'unknown', segments: [] })).toBeNull();
  });
  it('signed out: welcome, but lets the auth flow be', () => {
    expect(resolveGuard({ status: 'signedOut', gate: 'unknown', segments: ['(tabs)'] })).toBe('/welcome');
    expect(resolveGuard({ status: 'signedOut', gate: 'unknown', segments: ['offer'] })).toBe('/welcome');
    expect(resolveGuard({ status: 'signedOut', gate: 'unknown', segments: ['(auth)', 'otp'] })).toBeNull();
  });
  it('signed in, roles loading: stays put', () => {
    expect(resolveGuard({ status: 'signedIn', gate: 'unknown', segments: ['(auth)', 'otp'] })).toBeNull();
  });
  it('customers-only accounts land on the gate and stay there', () => {
    expect(resolveGuard({ status: 'signedIn', gate: 'denied', segments: ['(tabs)'] })).toBe('/not-partner');
    expect(resolveGuard({ status: 'signedIn', gate: 'denied', segments: ['(auth)', 'otp'] })).toBe('/not-partner');
    expect(resolveGuard({ status: 'signedIn', gate: 'denied', segments: ['not-partner'] })).toBeNull();
  });
  it('partners leave auth and the gate for home, and are left alone elsewhere', () => {
    expect(resolveGuard({ status: 'signedIn', gate: 'allowed', segments: ['(auth)', 'otp'] })).toBe('/');
    expect(resolveGuard({ status: 'signedIn', gate: 'allowed', segments: ['not-partner'] })).toBe('/');
    expect(resolveGuard({ status: 'signedIn', gate: 'allowed', segments: ['job'] })).toBeNull();
  });
});
