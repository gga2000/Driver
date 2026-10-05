// Generates the apps' alert tones as WAV files (16-bit mono PCM). Synthesised here, so there is no
// third-party audio to license. Re-run after changing a tone:   node scripts/dev/make-alert-sounds.mjs
//
//   apps/merchant/assets/sounds/new-order.wav         one bright three-note chime (G5 B5 E6), ~0.8 s
//   apps/merchant/assets/sounds/new-order-urgent.wav  1 s seamless loop of fast two-tone beeps (last 10 s)
//   apps/merchant/assets/sounds/courier.wav           two notes down (E6 B5): a courier about to walk in
//   apps/partner/assets/sounds/offer-loop.wav         1.6 s seamless loop: doorbell fifth + a short rest
//   apps/customer/assets/sounds/{accepted,picked-up,near,delivered}.wav
//                                                     the tracking screen's soft cues (maps program SP5b)
//
// The existing `offer.wav` (push notification channel sound) is left alone.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RATE = 22_050;

/** A note: a sine with odd harmonics (cuts through kitchen noise without square-wave harshness). */
function note(buf, { freq, at, dur, gain = 1, attack = 0.006, decay = 6 }) {
  const start = Math.round(at * RATE);
  const len = Math.round(dur * RATE);
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / attack) * Math.exp(-decay * t) * Math.min(1, (len - i) / (0.01 * RATE));
    const w = 2 * Math.PI * freq * t;
    const s = Math.sin(w) + 0.35 * Math.sin(3 * w) + 0.15 * Math.sin(5 * w) + 0.2 * Math.sin(2 * w);
    buf[start + i] += gain * env * s;
  }
}

/** Normalise to `peak` with a gentle soft clip (louder perceived level at the same peak). */
function finish(buf, peak = 0.95) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const k = max > 0 ? 1.6 / max : 1;
  const out = new Float32Array(buf.length);
  let m2 = 0;
  for (let i = 0; i < buf.length; i++) {
    out[i] = Math.tanh(buf[i] * k);
    m2 = Math.max(m2, Math.abs(out[i]));
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] / m2) * peak;
  return out;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function save(rel, samples) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, wav(samples));
  console.log(`${rel}  ${(samples.length / RATE).toFixed(2)} s`);
}

// Merchant: the new-order chime (G5 B5 E6, rising, the last note rings).
{
  const buf = new Float32Array(Math.round(0.85 * RATE));
  note(buf, { freq: 784, at: 0, dur: 0.22, decay: 7 });
  note(buf, { freq: 988, at: 0.16, dur: 0.22, decay: 7 });
  note(buf, { freq: 1319, at: 0.32, dur: 0.5, decay: 4.5 });
  save('apps/merchant/assets/sounds/new-order.wav', finish(buf));
}

// Merchant: the last 10 seconds — four fast alternating beeps per second, loops without a seam.
{
  const buf = new Float32Array(RATE);
  for (let k = 0; k < 4; k++) note(buf, { freq: k % 2 === 0 ? 1319 : 988, at: k * 0.25, dur: 0.17, decay: 3, attack: 0.004 });
  save('apps/merchant/assets/sounds/new-order-urgent.wav', finish(buf));
}

// Merchant: a courier is about to walk in (maps program SP7a) — two soft notes down (E6 → B5), unlike
// the rising new-order chime, so the counter knows which is which without looking.
{
  const buf = new Float32Array(Math.round(0.66 * RATE));
  note(buf, { freq: 1319, at: 0, dur: 0.26, decay: 6 });
  note(buf, { freq: 988, at: 0.2, dur: 0.48, decay: 4.5 });
  save('apps/merchant/assets/sounds/courier.wav', finish(buf, 0.7));
}

// Partner: the offer — a doorbell fifth (G5 → D6) then a rest; loops until he answers.
{
  const buf = new Float32Array(Math.round(1.6 * RATE));
  note(buf, { freq: 784, at: 0, dur: 0.24, decay: 6 });
  note(buf, { freq: 1175, at: 0.18, dur: 0.55, decay: 4 });
  note(buf, { freq: 784, at: 0.75, dur: 0.24, decay: 6 });
  note(buf, { freq: 1175, at: 0.93, dur: 0.6, decay: 4 });
  save('apps/partner/assets/sounds/offer-loop.wav', finish(buf));
}

// Customer: soft, short cues on the tracking screen (maps program SP5b) — quieter and rounder than the
// kitchen and courier alerts (a gentle peak, slow decays), each well under 30 KB.
{
  const soft = (dur) => new Float32Array(Math.round(dur * RATE));
  // Kitchen accepted: two notes up (E5 → A5).
  const accepted = soft(0.55);
  note(accepted, { freq: 659, at: 0, dur: 0.22, decay: 8 });
  note(accepted, { freq: 880, at: 0.14, dur: 0.38, decay: 6 });
  save('apps/customer/assets/sounds/accepted.wav', finish(accepted, 0.55));
  // On the way: three notes up (C5 E5 G5).
  const picked = soft(0.65);
  note(picked, { freq: 523, at: 0, dur: 0.2, decay: 8 });
  note(picked, { freq: 659, at: 0.12, dur: 0.2, decay: 8 });
  note(picked, { freq: 784, at: 0.24, dur: 0.4, decay: 5.5 });
  save('apps/customer/assets/sounds/picked-up.wav', finish(picked, 0.55));
  // Almost there: a two-tone doorbell (A5 → F#5), a little brighter so it is heard from the kitchen.
  const near = soft(0.65);
  note(near, { freq: 880, at: 0, dur: 0.3, decay: 5 });
  note(near, { freq: 740, at: 0.24, dur: 0.41, decay: 5 });
  save('apps/customer/assets/sounds/near.wav', finish(near, 0.7));
  // Delivered: a warm major arpeggio that rings out (C5 E5 G5 C6).
  const delivered = soft(0.68);
  note(delivered, { freq: 523, at: 0, dur: 0.3, decay: 6 });
  note(delivered, { freq: 659, at: 0.1, dur: 0.3, decay: 6 });
  note(delivered, { freq: 784, at: 0.2, dur: 0.35, decay: 5 });
  note(delivered, { freq: 1047, at: 0.3, dur: 0.38, decay: 5 });
  save('apps/customer/assets/sounds/delivered.wav', finish(delivered, 0.6));
}
