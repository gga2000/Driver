import { router } from 'expo-router';

/**
 * Google Play's prominent disclosure for background location (partner redesign f4): a real screen,
 * `/location-why`, shown right before the OS asks for "allow all the time" — never at sign-in, only
 * when he goes to work. The OS step awaits his answer here; leaving the screen any other way is "not now".
 */
let pending: ((ok: boolean) => void) | null = null;

export function askLocationDisclosure(): Promise<boolean> {
  // One at a time: a second ask while the screen is up shares the answer.
  if (pending) {
    const prev = pending;
    return new Promise((resolve) => {
      pending = (ok) => {
        prev(ok);
        resolve(ok);
      };
    });
  }
  return new Promise((resolve) => {
    pending = resolve;
    router.push('/location-why');
  });
}

/** The screen's answer (true: continue to the OS prompt). Safe to call more than once. */
export function answerLocationDisclosure(ok: boolean): void {
  const p = pending;
  pending = null;
  p?.(ok);
}
