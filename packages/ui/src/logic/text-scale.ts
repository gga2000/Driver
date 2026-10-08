/**
 * The app's text size setting on one line of text (courier n6). `scale` is the app's factor
 * (`textScale`); the phone's own text size still applies on top through `maxFontSizeMultiplier`.
 * A compact label (chip, pill, tab) never grows past `compactCap` in total, so its box still holds
 * it: the app's factor is clamped to the cap, and the phone gets only what is left of it.
 */
export function scaleText(
  base: { fontSize: number; lineHeight: number },
  scale: number,
  compact: boolean,
  compactCap: number,
): { fontSize: number; lineHeight: number; maxFontSizeMultiplier: number | undefined } {
  const factor = compact ? Math.min(scale, compactCap) : scale;
  return {
    fontSize: round(base.fontSize * factor),
    lineHeight: round(base.lineHeight * factor),
    maxFontSizeMultiplier: compact ? Math.max(1, compactCap / factor) : undefined,
  };
}

const round = (n: number) => Math.round(n * 2) / 2;
