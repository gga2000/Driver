// A drawn door (green door in a brick wall) as a PNG, for the demo customer's saved home: the
// courier's job shows it as the door photo (maps program f6). No network, no image files.
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';

const W = 192;
const H = 192;

function pixel(x, y) {
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

export function doorPng() {
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
