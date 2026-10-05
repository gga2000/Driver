/**
 * New-order alarm sound (web). A kitchen is loud, so this is a bright three-note chime made with
 * WebAudio (no files to fetch) and, for the last 10 seconds, a fast two-tone beep that repeats. Browsers
 * only allow sound after a tap: `unlock()` runs on the first pointer event and on "ابدأ الشغل";
 * `canPlay()` tells the board whether to show "الصوت طافي". Native: alert-sound.native.ts (expo-av,
 * bundled WAVs, plays in silent mode). Same API on both.
 */

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let unlocked = false;
let loopTimer: ReturnType<typeof setInterval> | null = null;
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

/** Call from a user gesture (any tap). Idempotent; resolves to whether sound can play now. */
export function unlock(): Promise<boolean> {
  const c = audioContext();
  if (!c) return Promise.resolve(false);
  return c.resume().then(
    () => {
      if (!unlocked && c.state === 'running') {
        unlocked = true;
        for (const l of listeners) l();
      }
      return unlocked;
    },
    () => false,
  );
}

if (typeof window !== 'undefined') {
  const once = () => void unlock();
  window.addEventListener('pointerdown', once, { capture: true });
  window.addEventListener('keydown', once, { capture: true });
}

function tone(c: Ctx, freq: number, start: number, dur: number, peak: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** One chime: three rising notes (G5 B5 E6); `volume` 0–1 (the ladder raises it as time runs out). */
export function chime(volume = 0.75): void {
  const c = audioContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  const peak = 0.45 * Math.max(0.05, Math.min(1, volume));
  [784, 988, 1319].forEach((freq, i) => tone(c, freq, now + i * 0.16, 0.22, peak));
}

/** The last-10-seconds tone: four alternating beeps a second, until `setLoop(false)`. */
export function setLoop(on: boolean): void {
  if (!on) {
    if (loopTimer) clearInterval(loopTimer);
    loopTimer = null;
    return;
  }
  if (loopTimer) return;
  const beep = () => {
    const c = audioContext();
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    for (let k = 0; k < 4; k++) tone(c, k % 2 === 0 ? 1319 : 988, now + k * 0.25, 0.17, 0.5);
  };
  beep();
  loopTimer = setInterval(beep, 1000);
}

/** Phones running the web build (Android Chrome) can buzz; tablets and desktops ignore it. */
export function vibrate(pattern: number[], repeat = false): void {
  const nav = (globalThis as { navigator?: { vibrate?: (p: number[]) => boolean } }).navigator;
  try {
    nav?.vibrate?.(repeat ? [...pattern, ...pattern, ...pattern] : pattern);
  } catch {
    /* not allowed before a tap */
  }
}

export function stopVibration(): void {
  const nav = (globalThis as { navigator?: { vibrate?: (p: number) => boolean } }).navigator;
  try {
    nav?.vibrate?.(0);
  } catch {
    /* ignore */
  }
}

/** "جرّب الصوت": unlock (it is a tap) and play one chime at full volume. Resolves to whether it played. */
export async function testChime(): Promise<boolean> {
  const ok = await unlock();
  if (ok) chime(1);
  return ok;
}

/** A courier is about to walk in (maps program SP7a): two softer notes down, unlike the new-order chime. */
export function courierChime(): void {
  const c = audioContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  tone(c, 1319, now, 0.26, 0.3);
  tone(c, 988, now + 0.2, 0.48, 0.3);
}

/** Older call sites: one chime at the calm volume. */
export function playNewOrder(): void {
  chime(0.75);
}
