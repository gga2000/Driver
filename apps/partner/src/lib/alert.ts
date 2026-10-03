/**
 * The offer alert (spec: "haptic + loud sound"). Web: a short two-tone chime through WebAudio,
 * repeated while the offer is on screen; silent when the browser blocks audio before a tap.
 * Native: `alert.native.ts`.
 */

type Ctx = { currentTime: number; destination: unknown; createOscillator(): Osc; createGain(): Gain; state?: string; resume?: () => Promise<void> };
type Osc = { type: string; frequency: { setValueAtTime(v: number, t: number): void }; connect(n: unknown): void; start(t: number): void; stop(t: number): void };
type Gain = { gain: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }; connect(n: unknown): void };

let ctx: Ctx | null = null;

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
  g.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
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
