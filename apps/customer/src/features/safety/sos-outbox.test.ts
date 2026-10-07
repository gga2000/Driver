import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SosView } from '@driver/contracts';
import { createSosOutbox, type SosOutboxDeps } from './sos-outbox';

const subject = { kind: 'order' as const, id: 'ord_1' };
const view = { incidentId: 'sos_1' } as unknown as SosView;

function setup(answers: Array<'offline' | 'fail' | 'ok'>) {
  vi.useFakeTimers();
  const box = createSosOutbox({ retryMs: 4_000, newId: () => 'sos-press-1' });
  let online = true;
  const send = vi.fn<SosOutboxDeps['send']>(async () => {
    const a = answers.shift() ?? 'ok';
    if (a === 'ok') return view;
    online = a !== 'offline';
    throw new TypeError('Network request failed');
  });
  box.setDeps({ send, fix: async () => null, online: () => online });
  return { box, send, goOnline: () => (online = true) };
}

afterEach(() => vi.useRealTimers());

describe('SOS outbox (FLOW-05)', () => {
  it('keeps retrying a press that failed offline, with nothing on screen holding it', async () => {
    const { box, send } = setup(['offline', 'offline', 'ok']);
    box.press(subject);
    await vi.advanceTimersByTimeAsync(0);
    expect(box.getState().failure).toBe('offline');
    expect(box.pendingFor(subject)).toBe(true);
    // No sheet, no screen: the outbox alone keeps trying.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(box.getState()).toMatchObject({ press: null, failure: null, delivered: { subjectKey: 'order:ord_1', view } });
    // Delivered: it stops.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('every try is the same incident: one client id and press time', async () => {
    const { box, send } = setup(['fail', 'ok']);
    const p = box.press(subject);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(send.mock.calls.map((c) => c[0].clientId)).toEqual(['sos-press-1', 'sos-press-1']);
    expect(send.mock.calls.every((c) => c[0].pressedAt === p.pressedAt)).toBe(true);
  });

  it('tries at once when the network comes back, instead of waiting for the next tick', async () => {
    const { box, send, goOnline } = setup(['offline', 'ok']);
    box.press(subject);
    await vi.advanceTimersByTimeAsync(0);
    goOnline();
    box.nudge();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(box.getState().delivered?.view).toBe(view);
  });

  it('says whether it failed for the network or the server', async () => {
    const { box } = setup(['fail']);
    box.press(subject);
    await vi.advanceTimersByTimeAsync(0);
    expect(box.getState().failure).toBe('failed');
  });

  it('nudging with nothing pending does nothing', async () => {
    const { box, send } = setup([]);
    box.nudge();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
  });
});
