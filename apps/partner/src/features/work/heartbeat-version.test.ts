import { describe, expect, it } from 'vitest';
import type { PartnerStatus } from '@driver/contracts';
import { heartbeatStep, versionToSend } from './heartbeat-version';

const STATUS = { personId: 'drv1', online: true, position: { lat: 32.9, lng: 45.06 } } as PartnerStatus;
const AT = { lat: 32.901, lng: 45.061 };

describe('the heartbeat version (perf o4)', () => {
  it('sends the held version only while the cache is still the status it came with', () => {
    expect(versionToSend(null, 100)).toBe('');
    expect(versionToSend({ version: 'v1', updatedAt: 100 }, 100)).toBe('v1');
    // The status was re-read since (live channel, poll, go offline): ask afresh.
    expect(versionToSend({ version: 'v1', updatedAt: 100 }, 250)).toBe('');
  });

  it('unchanged: keeps the cached status, with the position just sent', () => {
    expect(heartbeatStep({ changed: false, version: 'v1' }, AT, { version: 'v1', updatedAt: 100 }, 100)).toEqual({ kind: 'keep', position: AT, version: 'v1' });
    // Re-read between the send and the answer: that copy is not the versioned one.
    expect(heartbeatStep({ changed: false, version: 'v1' }, AT, { version: 'v1', updatedAt: 100 }, 250)).toEqual({ kind: 'forget' });
  });

  it('changed: the new status and its version replace the cache', () => {
    expect(heartbeatStep({ changed: true, version: 'v2', status: STATUS }, AT, { version: 'v1', updatedAt: 100 }, 100)).toEqual({ kind: 'replace', status: STATUS, version: 'v2' });
  });

  it('an older server (the full status, no version) replaces the cache and holds no version', () => {
    expect(heartbeatStep(STATUS, AT, { version: 'v1', updatedAt: 100 }, 100)).toEqual({ kind: 'replace', status: STATUS, version: null });
  });
});
