// Drawn photos as PNGs for the demo, no network and no image files: a door (green door in a brick
// wall) for the customer's saved home — the courier's job shows it as the door photo (maps program
// f6) — and a restaurant's takeaway window for مطعم خالد's pickup spot (maps program r7).
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';

const W = 192;
const H = 192;

function doorPixel(x, y) {
  if (x >= 62 && x < 130 && y >= 40 && y < 176) {
    if (x >= 66 && x < 126 && y >= 44) return x === 96 || (y > 104 && y < 108) ? [22, 84, 54] : x > 112 && x < 118 && y > 108 && y < 116 ? [214, 170, 60] : [34, 120, 76];
    return [120, 92, 62];
  }
  if (y >= 176) return [176, 160, 136];
  const brick = (Math.floor(y / 12) % 2 === 0 ? x : x + 16) % 32 < 1 || y % 12 < 1;
  return brick ? [214, 196, 168] : [236, 222, 196];
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

/** A W×H RGB PNG from a pixel function. */
function png(pixel) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) raw.set(pixel(x, y), y * (W * 3 + 1) + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function doorPng() {
  return png(doorPixel);
}

/** A shop front: an orange awning over a lit window on the left (the counter), a closed door on the right. */
function windowPixel(x, y) {
  if (y < 36) return (Math.floor(x / 16) % 2 === 0) ? [224, 138, 30] : [246, 236, 214];
  if (y < 44) return [150, 96, 40];
  if (x >= 20 && x < 104 && y >= 64 && y < 132) {
    if (x < 24 || x >= 100 || y < 68 || y >= 128) return [70, 70, 74];
    if (y >= 112) return [196, 164, 120];
    return x === 62 ? [70, 70, 74] : [250, 226, 150];
  }
  if (x >= 128 && x < 172 && y >= 72 && y < 176) return x > 162 && x < 166 && y > 120 && y < 128 ? [214, 170, 60] : [96, 72, 52];
  if (y >= 176) return [176, 160, 136];
  return [232, 226, 214];
}

export function pickupWindowPng() {
  return png(windowPixel);
}
