/**
 * ESC/POS bytes for a cheap thermal printer (print redesign step 4). Arabic goes out as a picture:
 * these printers cannot join Arabic letters, so each document is drawn at the head's exact width
 * (384, 512 or 576 dots), turned into pure black and white (a thermal head has no grey) and sent in
 * strips with `GS v 0`. Then a feed and a cut on printers with a cutter (i29); a short beep first on
 * printers with a buzzer (i28). Pure bytes: the Bluetooth driver of the tablet build sends them.
 */

/** A 1-bit image: `width` dots across (a multiple of 8), rows of packed bits, MSB = leftmost dot. */
export interface Bitmap {
  width: number;
  height: number;
  /** `width / 8 * height` bytes; a set bit is a black dot. */
  data: Uint8Array;
}

const ESC = 0x1b;
const GS = 0x1d;

/** Strip height for `GS v 0`: small enough for a printer's buffer, big enough to stay fast. */
export const STRIP_ROWS = 256;

/** RGBA pixels → 1-bit, a dot is black when it is darker than `threshold` (no dithering: text and rules only). */
export function toBitmap(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, threshold = 160): Bitmap {
  const bytesPerRow = Math.ceil(width / 8);
  const out = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3]! / 255;
      // Transparent counts as white paper.
      const lum = (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) * a + 255 * (1 - a);
      if (lum < threshold) out[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { width: bytesPerRow * 8, height, data: out };
}

/** `GS v 0` raster strips for one image. */
export function rasterBytes(img: Bitmap): number[] {
  const bytesPerRow = img.width / 8;
  const out: number[] = [];
  for (let y0 = 0; y0 < img.height; y0 += STRIP_ROWS) {
    const rows = Math.min(STRIP_ROWS, img.height - y0);
    out.push(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff);
    const start = y0 * bytesPerRow;
    for (let i = 0; i < rows * bytesPerRow; i += 1) out.push(img.data[start + i]!);
  }
  return out;
}

export const COMMANDS = {
  init: [ESC, 0x40],
  /** Buzzer: `ESC B n t` — 2 beeps of 100 ms (printers without one ignore it). */
  beep: [ESC, 0x42, 2, 1],
  /** Feed 4 lines so the cut clears the print. */
  feed: [ESC, 0x64, 4],
  /** Partial cut (leaves a hinge so the slip doesn't fall on the floor). */
  cut: [GS, 0x56, 0x42, 0x00],
} as const;

/** A whole job: beep, then each document followed by a feed and (with a cutter) a cut. */
export function jobBytes(images: readonly Bitmap[], opts: { beep: boolean; cut: boolean }): Uint8Array {
  const out: number[] = [...COMMANDS.init];
  if (opts.beep) out.push(...COMMANDS.beep);
  for (const img of images) {
    out.push(...rasterBytes(img), ...COMMANDS.feed);
    if (opts.cut) out.push(...COMMANDS.cut);
  }
  return Uint8Array.from(out);
}
