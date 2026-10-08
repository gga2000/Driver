/**
 * English words (speed w5). On a phone they are in the app from the start, so there is nothing to
 * load; the website loads them only when someone picks English (english.web.ts).
 */
export const englishReady = (): boolean => true;
export const englishVersion = (): number => 0;
export const onEnglish =
  (_listener: () => void): (() => void) =>
  () =>
    undefined;
export const loadEnglish = (): Promise<void> => Promise.resolve();
