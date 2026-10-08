import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SosView } from '@driver/contracts';
import { createMemoryStorage } from '@/lib/storage';
import { createSosOutbox, SOS_PENDING_KEY, SOS_RESEND_MAX_AGE_MS, type SosOutboxDeps } from './sos-outbox';

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

  it('a 401 while the phone still holds a session is a refresh not through yet: retried, then sent', async () => {
    vi.useFakeTimers();
    const box = createSosOutbox({ retryMs: 4_000, newId: () => 'sos-press-1' });
    const unauthorized = Object.assign(new Error('unauthorized'), { data: { httpStatus: 401, code: 'unauthorized' } });
    const answers: Array<'401' | 'ok'> = ['401', 'ok'];
    const send = vi.fn<SosOutboxDeps['send']>(async () => {
      if (answers.shift() === '401') throw unauthorized;
      return view;
    });
    box.setDeps({ send, fix: async () => null, online: () => true, signedIn: () => true });
    box.press(subject);
    await vi.advanceTimersByTimeAsync(0);
    expect(box.getState()).toMatchObject({ failure: 'failed', refused: null });
    expect(box.pendingFor(subject)).toBe(true);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].clientId).toBe('sos-press-1');
    expect(box.getState()).toMatchObject({ press: null, failure: null, delivered: { subjectKey: 'order:ord_1', view } });
  });

  it('a 401 with the session gone is final: the person is pointed to 911', async () => {
    vi.useFakeTimers();
    const box = createSosOutbox({ retryMs: 4_000, newId: () => 'sos-press-1' });
    const unauthorized = Object.assign(new Error('unauthorized'), { data: { httpStatus: 401, code: 'unauthorized' } });
    const send = vi.fn<SosOutboxDeps['send']>(async () => {
      throw unauthorized;
    });
    box.setDeps({ send, fix: async () => null, online: () => true, signedIn: () => false });
    box.press(subject);
    await vi.advanceTimersByTimeAsync(0);
    expect(box.getState()).toMatchObject({ press: null, refused: { subjectKey: 'order:ord_1', restored: false } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stops on a definitive refusal and says so, instead of retrying forever', async () => {
    vi.useFakeTimers();
    const box = createSosOutbox({ retryMs: 4_000, newId: () => 'sos-press-1' });
    const refusal = Object.assign(new Error('forbidden'), { data: { httpStatus: 403, code: 'forbidden' } });
    const send = vi.fn<SosOutboxDeps['send']>(async () => {
      throw refusal;
    });
    box.setDeps({ send, fix: async () => null, online: () => true });
    box.press(subject);
    await vi.advanceTimersByTimeAsync(0);
    expect(box.getState()).toMatchObject({ press: null, failure: null, refused: { subjectKey: 'order:ord_1', restored: false } });
    expect(box.pendingFor(subject)).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a press made offline survives the app being killed and is sent on the next launch, as the same incident', async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorage();
    const fix = { lat: 32.91, lng: 45.06, accuracyM: 12, at: new Date() } as never;
    const first = createSosOutbox({ retryMs: 4_000, newId: () => 'sos-press-1', storage });
    first.setDeps({ send: async () => Promise.reject(new TypeError('Network request failed')), fix: async () => fix, online: () => false });
    const p = first.press(subject);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.dump()[SOS_PENDING_KEY]).toBeDefined();

    // The app is killed; a new launch, still without a fix this time.
    const second = createSosOutbox({ retryMs: 4_000, storage });
    const send = vi.fn<SosOutboxDeps['send']>(async () => view);
    second.setDeps({ send, fix: async () => null, online: () => true });
    await second.restore();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ clientId: 'sos-press-1', subject, position: fix });
    expect(send.mock.calls[0]![0].pressedAt.getTime()).toBe(p.pressedAt.getTime());
    expect(second.getState().delivered).toMatchObject({ restored: true, view });
    expect(storage.dump()[SOS_PENDING_KEY]).toBeUndefined();
  });

  it('a saved press too old to matter is not sent at launch; the person is pointed to 911 instead', async () => {
    vi.useFakeTimers();
    const pressedAt = new Date('2026-10-07T20:00:00Z');
    const storage = createMemoryStorage({ [SOS_PENDING_KEY]: JSON.stringify({ clientId: 'sos-old', pressedAt: pressedAt.toISOString(), subject, position: null }) });
    const box = createSosOutbox({ storage, now: () => pressedAt.getTime() + SOS_RESEND_MAX_AGE_MS + 1 });
    const send = vi.fn<SosOutboxDeps['send']>(async () => view);
    box.setDeps({ send, fix: async () => null, online: () => true });
    await box.restore();
    expect(send).not.toHaveBeenCalled();
    expect(box.getState().refused).toMatchObject({ subjectKey: 'order:ord_1', restored: true });
    expect(storage.dump()[SOS_PENDING_KEY]).toBeUndefined();
  });
});
