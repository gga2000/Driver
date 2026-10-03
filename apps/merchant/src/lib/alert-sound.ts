/**
 * New-order alarm (web). A kitchen is loud, so this is a bright, repeated three-note chime made with
 * WebAudio — no audio files to ship. Browsers only allow sound after a tap on the page: `unlock()`
 * runs on the first pointer event, and `canPlay()` tells the board whether to show the "شغّل صوت
 * الطلبات" button. Native: alert-sound.native.ts (vibration until a sound module ships).
 */

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let unlocked = false;
const listeners = new Set<() => void>();

function audioContext(): Ctx | null {
  if (ctx) return ctx;
  const W = globalThis as unknown as { AudioContext?: new () => Ctx; webkitAudioContext?: new () => Ctx };
  const C = W.AudioContext ?? W.webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C();
  } catch {
    ctx = null;
  }
  return ctx;
}

export function canPlay(): boolean {
  return unlocked;
}

export function onUnlock(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Call from a user gesture (any tap). Idempotent. */
export function unlock(): void {
  const c = audioContext();
  if (!c) return;
  void c.resume().then(() => {
    if (unlocked) return;
    unlocked = c.state === 'running';
    if (unlocked) for (const l of listeners) l();
  });
}

if (typeof window !== 'undefined') {
  const once = () => unlock();
  window.addEventListener('pointerdown', once, { capture: true });
  window.addEventListener('keydown', once, { capture: true });
}

/** One chime: three rising notes, loud and short. */
export function playNewOrder(): void {
  const c = audioContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  const notes = [784, 988, 1319]; // G5 B5 E6
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    const start = now + i * 0.16;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.24);
  });
}
