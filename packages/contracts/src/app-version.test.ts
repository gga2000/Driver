import { describe, expect, it } from 'vitest';
import { appHeader, compareVersions, isUpdateRequiredError, minAppVersionsFromEnv, parseAppHeader, updateRequired } from './app-version.js';
import { errorMessageKey } from './errors.js';

describe('app version gate (CORE-05)', () => {
  it('reads the header the apps send, and nothing else', () => {
    expect(parseAppHeader(appHeader('customer', '1.0.3'))).toEqual({ app: 'customer', version: '1.0.3' });
    expect(parseAppHeader(['partner/2.1', 'x'])).toEqual({ app: 'partner', version: '2.1' });
    expect(parseAppHeader(undefined)).toBeNull();
    expect(parseAppHeader('console/1.0.0')).toBeNull();
    expect(parseAppHeader('customer/1.0.0-beta')).toBeNull();
    expect(parseAppHeader('customer')).toBeNull();
  });

  it('compares versions by number', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });

  it('turns away only builds older than their own app minimum', () => {
    const mins = minAppVersionsFromEnv('customer:1.0.3, partner:2.0.0');
    expect(updateRequired({ app: 'customer', version: '1.0.2' }, mins)).toBe(true);
    expect(updateRequired({ app: 'customer', version: '1.0.3' }, mins)).toBe(false);
    expect(updateRequired({ app: 'merchant', version: '0.0.1' }, mins)).toBe(false);
    expect(updateRequired(null, mins)).toBe(false);
    expect(minAppVersionsFromEnv(undefined)).toEqual({});
  });

  it('refuses a typo in MIN_APP_VERSIONS instead of guessing', () => {
    expect(() => minAppVersionsFromEnv('customer=1.0.3')).toThrow(/MIN_APP_VERSIONS/);
    expect(() => minAppVersionsFromEnv('driver:1.0.0')).toThrow(/MIN_APP_VERSIONS/);
  });

  it('has its message, and the apps can recognise it', () => {
    expect(errorMessageKey('update_required')).toBe('error.update_required');
    expect(isUpdateRequiredError({ data: { code: 'update_required' } })).toBe(true);
    expect(isUpdateRequiredError(new Error('x'))).toBe(false);
  });
});
