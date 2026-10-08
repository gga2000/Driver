import { afterEach, describe, expect, it, vi } from 'vitest';
import { appBuildHeaders, appUpdate } from './app-update';
import { shouldRetryQuery } from './errors';

const updateRequired = { data: { code: 'update_required', httpStatus: 412 } };

describe('CORE-05: which build is calling, and «حدّث التطبيق»', () => {
  afterEach(() => appUpdate.reset());

  it('sends customer/<store version> from native builds only', () => {
    expect(appBuildHeaders('android', '1.0.3')).toEqual({ 'x-driver-app': 'customer/1.0.3' });
    expect(appBuildHeaders('ios', '1.2')).toEqual({ 'x-driver-app': 'customer/1.2' });
    expect(appBuildHeaders('web', '1.0.3')).toEqual({});
    expect(appBuildHeaders('android', null)).toEqual({});
  });

  it('latches on update_required and tells the screen once; other errors leave it alone', () => {
    const seen = vi.fn();
    const off = appUpdate.subscribe(seen);
    appUpdate.noteError({ data: { code: 'not_found' } });
    appUpdate.noteError(new Error('offline'));
    expect(appUpdate.isRequired()).toBe(false);
    appUpdate.noteError(updateRequired);
    appUpdate.noteError(updateRequired);
    expect(appUpdate.isRequired()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it('never retries a call the server refused for an old build', () => {
    expect(shouldRetryQuery(0, updateRequired)).toBe(false);
  });
});
