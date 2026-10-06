/**
 * The share card's artboard (joy l5): 9:16 at 360 × 640 logical units, exported at 3× (1080 × 1920,
 * the Instagram / WhatsApp story size). One set of numbers for the phone's view (captured) and the
 * web's canvas, so both pictures match.
 */
export const CARD = {
  w: 360,
  h: 640,
  scale: 3,
  pad: 28,
  /** The art: a dish in its arch window (square), or an arch scene (16:10). */
  dishTop: 84,
  dishSize: 280,
  sceneTop: 130,
  sceneW: 304,
  sceneH: 190,
  headY: 430,
  headSize: 46,
  subY: 490,
  subSize: 20,
  brandY: 590,
  brandSize: 16,
  ruleY: 556,
} as const;
