'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * The needs-dispatcher alert (K-05): on by default, two tones (880 then 660 Hz) each time the
 * count goes up, with a visible mute that the browser remembers. Browsers only let a page play sound
 * after the person has touched it, so the first click or key anywhere unlocks it; until then the
 * mute button says the sound is waiting for that.
 */

const KEY = 'driver.console.dispatch.sound';
const listeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    window.localStorage.setItem(KEY, muted ? 'off' : 'on');
  } catch {
    /* private window: it still applies for this visit */
  }
  memo = muted;
  for (const l of listeners) l();
}

let memo: boolean | null = null;
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export function useMuted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (memo ??= readMuted()),
    () => false,
  );
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctx = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return null;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }
  return ctx;
}

function chime(c: AudioContext) {
  [
    [0, 880],
    [0.22, 660],
  ].forEach(([at, hz]) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = hz!;
    gain.gain.setValueAtTime(0.0001, c.currentTime + at!);
    gain.gain.exponentialRampToValueAtTime(0.16, c.currentTime + at! + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at! + 0.2);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime + at!);
    osc.stop(c.currentTime + at! + 0.22);
  });
}

/** Rings when `count` rises (not on the first read). Returns whether the browser still blocks sound. */
export function useNeedsAlert(count: number, known: boolean): { blocked: boolean } {
  const muted = useMuted();
  const prev = useRef<number | null>(null);
  const [blocked, setBlocked] = useState(false);

  // Unlock on the first gesture.
  useEffect(() => {
    const c = audio();
    if (!c) return;
    const sync = () => setBlocked(c.state !== 'running');
    sync();
    const unlock = () => void c.resume().then(sync, sync);
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    c.addEventListener('statechange', sync);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      c.removeEventListener('statechange', sync);
    };
  }, []);

  useEffect(() => {
    if (!known) return;
    const was = prev.current;
    prev.current = count;
    if (was === null || count <= was || muted) return;
    const c = audio();
    if (c && c.state === 'running') chime(c);
  }, [count, known, muted]);

  return { blocked: blocked && !muted };
}
