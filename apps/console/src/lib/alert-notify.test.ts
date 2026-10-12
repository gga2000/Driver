import { describe, expect, it, vi } from 'vitest';
import type { KhatSweepAlert, SafetyIncidentSummary } from '@driver/contracts';
import { sosSystemAlerts, sweepSystemAlerts } from './alert-notify';
import { askNotifyPermission, freshAlerts, notifyPermission, showSystemAlert, titleFrame } from './alert-system';

const sos = (id: string, state: SafetyIncidentSummary['state']): SafetyIncidentSummary =>
  ({ id, state, raisedAt: new Date(0), raiser: { personId: 'p', role: 'driver', displayName: 'حيدر ك.', phoneMasked: null }, subject: { label: 'مشوار تكتك #1290' } }) as SafetyIncidentSummary;

const sweep = (id: string, over: Partial<KhatSweepAlert> = {}): KhatSweepAlert =>
  ({
    alertId: id,
    tripId: `trip_${id}`,
    cityId: 'aziziyah',
    driver: { personId: 'd1', displayName: 'حيدر ك.', phoneMasked: null },
    childrenTotal: 2,
    lastDropAt: null,
    lastDropZone: null,
    runEndedAt: new Date(0),
    raisedAt: new Date(0),
    confirmedAt: null,
    confirmedLateMin: null,
    closedAt: null,
    closedById: null,
    closeReason: null,
    closeNote: null,
    ...over,
  }) as KhatSweepAlert;

function fakeNotification(permission: 'default' | 'granted' | 'denied') {
  const made: Array<{ title: string; options: Record<string, unknown>; onclick: (() => void) | null; close: ReturnType<typeof vi.fn> }> = [];
  class N {
    static permission = permission;
    static requestPermission = vi.fn(async () => 'granted' as const);
    onclick: (() => void) | null = null;
    close = vi.fn();
    constructor(
      public title: string,
      public options: Record<string, unknown>,
    ) {
      made.push(this as never);
    }
  }
  return { api: N as never, made, N };
}

describe('the alarm away from the Console tab', () => {
  it('turns open SOS alerts (not taken ones) and open sweeps (not confirmed or closed) into alerts', () => {
    const a = sosSystemAlerts([sos('s1', 'open'), sos('s2', 'acknowledged'), sos('s3', 'resolved')]);
    expect(a).toEqual([{ id: 'sos:s1', title: 'طوارئ: محد استلمها', body: 'حيدر ك. (سايق) · مشوار تكتك #1290', href: '/safety/s1' }]);
    const w = sweepSystemAlerts([sweep('k1'), sweep('k2', { confirmedAt: new Date(1) }), sweep('k3', { closedAt: new Date(1) })], 6 * 60_000);
    expect(w.map((x) => x.id)).toEqual(['sweep:k1']);
    expect(w[0]!.title).toBe('حيدر ك. ما تأكد إن السيارة فاضية');
    expect(w[0]!.href).toBe('/safety');
  });

  it('notifies each alert once per tab', () => {
    const seen = new Set<string>();
    const one = sosSystemAlerts([sos('s1', 'open')]);
    expect(freshAlerts(one, seen).map((a) => a.id)).toEqual(['sos:s1']);
    expect(freshAlerts(one, seen)).toEqual([]);
    const two = sosSystemAlerts([sos('s1', 'open'), sos('s2', 'open')]);
    expect(freshAlerts(two, seen).map((a) => a.id)).toEqual(['sos:s2']);
  });

  it('shows a notification that stays until clicked, tagged by alert, and the click opens the alert', () => {
    const { api, made } = fakeNotification('granted');
    const open = vi.fn();
    const [a] = sosSystemAlerts([sos('s1', 'open')]);
    vi.stubGlobal('window', { focus: vi.fn() });
    expect(showSystemAlert(a!, open, api)).toBe(true);
    expect(made[0]!.title).toBe('طوارئ: محد استلمها');
    expect(made[0]!.options).toMatchObject({ tag: 'sos:s1', requireInteraction: true, dir: 'rtl' });
    made[0]!.onclick!();
    expect(open).toHaveBeenCalledWith('/safety/s1');
    expect(made[0]!.close).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shows nothing without permission, and asks only while the browser has no answer', async () => {
    const denied = fakeNotification('denied');
    const [a] = sosSystemAlerts([sos('s1', 'open')]);
    expect(showSystemAlert(a!, vi.fn(), denied.api)).toBe(false);
    expect(denied.made).toHaveLength(0);
    expect(await askNotifyPermission(denied.api)).toBe('denied');
    expect(denied.N.requestPermission).not.toHaveBeenCalled();
    const fresh = fakeNotification('default');
    expect(notifyPermission(fresh.api)).toBe('default');
    expect(await askNotifyPermission(fresh.api)).toBe('granted');
    expect(notifyPermission(null)).toBe('unsupported');
  });

  it('flashes the tab title every other second', () => {
    expect(titleFrame('الكونسول', 2, 0)).toBe('(2) طوارئ · افتح الكونسول');
    expect(titleFrame('الكونسول', 2, 1)).toBe('الكونسول');
  });
});
