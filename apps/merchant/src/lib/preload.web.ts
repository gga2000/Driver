import { useEffect } from 'react';
import { ctx } from 'expo-router/_ctx';
import { getNetwork } from '@driver/ui';

/**
 * Day-one d02 (web): the web build loads each screen's code the first time it opens, so with the net
 * down a tab that was never opened can't open at all. Once the board is up and the net is fine, every
 * screen's code is fetched quietly in the background (the router's own route list, so the very same
 * files), and a tab change later never needs the net. Anything that failed is tried again when the net
 * comes back.
 */
const done = new Set<string>();
let running: Promise<void> | null = null;

function preloadAll(): Promise<void> {
  running ??= Promise.all(
    ctx
      .keys()
      .filter((k) => !done.has(k))
      .map((k) =>
        Promise.resolve()
          .then(() => ctx(k) as unknown)
          .then(
            () => {
              done.add(k);
            },
            () => undefined,
          ),
      ),
  ).then(() => {
    running = null;
  });
  return running;
}

const complete = () => ctx.keys().every((k) => done.has(k));

/** Starts the background load a few seconds after `enabled` (signed in, board showing). */
export function usePreloadScreens(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const net = getNetwork();
    const tryNow = () => {
      if (net.getSnapshot().state === 'online' && !complete()) void preloadAll();
    };
    const id = setTimeout(tryNow, 3000);
    const off = net.subscribe(tryNow);
    return () => {
      clearTimeout(id);
      off();
    };
  }, [enabled]);
}
