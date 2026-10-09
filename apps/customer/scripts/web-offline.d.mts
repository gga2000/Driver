/** Types for scripts/web-offline.mjs (imported by src/lib/web-build.test.ts). */
export declare const SCREEN_MAX_BYTES: number;
export declare function prepareOffline(
  dir: string,
  options?: { enabled?: boolean },
): { build: string; precache: { url: string; shell: boolean }[] };
