// Demo portraits for the in-memory demo APIs (driver main photos, خطوط child photos): a simple drawn
// head-and-shoulders on a warm background, as a real PNG (the upload check sniffs the magic bytes).
// Deterministic per seed, no dependencies (zlib + a CRC). Not a person: a placeholder that reads as
// "a photo is here" in the apps and the Console approvals queue.
//
//   import { avatarPng } from '../../../scripts/dev/demo-avatar.mjs';
//   const bytes = avatarPng('كرار', { size: 256 });
import { deflateSync } from 'node:zlib';

const BACKGROUNDS = [
  [240, 214, 178], // sand
  [214, 228, 214], // sage
  [222, 214, 236], // lavender
  [246, 206, 170], // apricot
  [206, 222, 236], // sky
  [236, 220, 196], // cream
];
const SKIN = [
  [214, 170, 132],
  [190, 146, 108],
  [226, 186, 150],
  [168, 124, 92],
];
const SHIRTS = [
  [70, 96, 128],
  [120, 74, 60],
  [62, 104, 88],
  [92, 84, 120],
  [146, 112, 54],
];
const HAIR = [
  [40, 32, 28],
  [62, 46, 36],
  [28, 26, 26],
];

function hash(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A PNG portrait (RGB, `size`×`size`). `child: true` draws a smaller head with a school collar. */
export function avatarPng(seed, { size = 256, child = false } = {}) {
  const h = hash(seed);
  const bg = BACKGROUNDS[h % BACKGROUNDS.length];
  const skin = SKIN[(h >>> 3) % SKIN.length];
  const shirt = child ? [64, 92, 140] : SHIRTS[(h >>> 6) % SHIRTS.length];
  const hair = HAIR[(h >>> 9) % HAIR.length];
  const s = size;
  const head = { x: s * 0.5, y: s * (child ? 0.44 : 0.4), r: s * (child ? 0.17 : 0.19) };
  const body = { x: s * 0.5, y: s * 1.02, rx: s * (child ? 0.34 : 0.4), ry: s * 0.36 };
  const raw = Buffer.alloc((s * 3 + 1) * s);
  for (let y = 0; y < s; y += 1) {
    raw[y * (s * 3 + 1)] = 0;
    for (let x = 0; x < s; x += 1) {
      let c = bg;
      // A soft vignette so it reads as a photo, not a flat tile.
      const v = 1 - 0.12 * (((x - s / 2) ** 2 + (y - s / 2) ** 2) / (s * s * 0.5));
      const inBody = ((x - body.x) / body.rx) ** 2 + ((y - body.y) / body.ry) ** 2 <= 1;
      const neck = Math.abs(x - head.x) < s * 0.06 && y > head.y && y < head.y + head.r * 1.45;
      const dHead = ((x - head.x) / head.r) ** 2 + ((y - head.y) / (head.r * 1.12)) ** 2;
      if (inBody) c = shirt;
      if (child && inBody && Math.abs(x - head.x) < s * 0.09 && y < body.y - body.ry * 0.62) c = [244, 244, 240];
      if (neck) c = skin.map((k) => k * 0.92);
      if (dHead <= 1) {
        const top = y < head.y - head.r * 0.35 || (dHead > 0.72 && y < head.y);
        c = top ? hair : skin;
        // Eyes and a smile, small and calm.
        const eyeY = head.y - head.r * 0.05;
        for (const ex of [head.x - head.r * 0.36, head.x + head.r * 0.36]) if ((x - ex) ** 2 + (y - eyeY) ** 2 <= (s * 0.014) ** 2) c = [36, 30, 28];
        const my = head.y + head.r * 0.42;
        const md = Math.sqrt((x - head.x) ** 2 + (y - (my - head.r * 0.22)) ** 2);
        if (Math.abs(md - head.r * 0.3) < s * 0.006 && y > my - head.r * 0.05) c = [150, 82, 70];
      }
      const o = y * (s * 3 + 1) + 1 + x * 3;
      raw[o] = Math.max(0, Math.min(255, Math.round(c[0] * v)));
      raw[o + 1] = Math.max(0, Math.min(255, Math.round(c[1] * v)));
      raw[o + 2] = Math.max(0, Math.min(255, Math.round(c[2] * v)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
