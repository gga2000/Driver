/**
 * The offer alert (spec: "haptic + loud sound", UI/UX audit P-01). Web: a two-tone doorbell through
 * WebAudio, repeated every 1.6 s while the offer is on screen (silent until the page had a tap; the
 * ring and the haptic still tell him). Native: `alert.native.ts` (a bundled looping tone that plays
 * in silent mode, plus a vibration pattern). Same API on both.
 */

type Ctx = { currentTime: number; destination: unknown; createOscillator(): Osc; createGain(): Gain; state?: string; resume?: () => Promise<void> };
type Osc = { type: string; frequency: { setValueAtTime(v: number, t: number): void }; connect(n: unknown): void; start(t: number): void; stop(t: number): void };
type Gain = { gain: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }; connect(n: unknown): void };

/** One doorbell every this many ms while an offer waits (matches the native loop's length). */
export const OFFER_REPEAT_MS = 1_600;
/** Vibration pattern for a new offer (haptics map: heavy, repeated with the sound). */
export const OFFER_VIBRATION = [0, 600, 300, 600];

let ctx: Ctx | null = null;
let loop: ReturnType<typeof setInterval> | null = null;

function audio(): Ctx | null {
  if (ctx) return ctx;
  const AC = (globalThis as { AudioContext?: new () => Ctx; webkitAudioContext?: new () => Ctx }).AudioContext ?? (globalThis as { webkitAudioContext?: new () => Ctx }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

function tone(c: Ctx, freq: number, at: number, dur: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** One chime: rising fifth, like a doorbell. */
export function playOfferChime(): void {
  const c = audio();
  if (!c) return;
  try {
    if (c.state === 'suspended') void c.resume?.();
    const t = c.currentTime + 0.01;
    tone(c, 784, t, 0.18);
    tone(c, 1175, t + 0.16, 0.32);
  } catch {
    /* audio blocked until the first tap: the haptic and the ring still tell him */
  }
}

function buzz(pattern: number[]) {
  const nav = (globalThis as { navigator?: { vibrate?: (p: number[] | number) => boolean } }).navigator;
  try {
    nav?.vibrate?.(pattern);
  } catch {
    /* not allowed before a tap */
  }
}

/** The offer arrived: the doorbell (and a buzz on phones) until `stopOfferAlert()`. */
export function startOfferAlert(): void {
  stopOfferAlert();
  playOfferChime();
  buzz(OFFER_VIBRATION);
  loop = setInterval(() => {
    playOfferChime();
    buzz(OFFER_VIBRATION);
  }, OFFER_REPEAT_MS);
}

/** Answered, expired or taken: quiet at once. */
export function stopOfferAlert(): void {
  if (loop) clearInterval(loop);
  loop = null;
  buzz([0]);
}

/** "جرّب صوت الطلب": one doorbell (the tap itself unlocks browser audio). Resolves to whether it could play. */
export async function playTestSound(): Promise<boolean> {
  const c = audio();
  if (!c) return false;
  try {
    await c.resume?.();
  } catch {
    return false;
  }
  playOfferChime();
  buzz(OFFER_VIBRATION);
  return c.state === undefined || c.state === 'running';
}
