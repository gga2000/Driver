import { useEffect } from 'react';

/** Web: the browser can't change the screen's brightness (native: `brightness.native.ts`). */
export function useFullBrightness(_on: boolean): void {
  useEffect(() => undefined, []);
}
