/* global XMLSerializer, FontFace, Image, Buffer -- runs in Node and composes inside the browser page */
// «ستيكرات درايفر» (joy g7): exports the WhatsApp sticker pack and the invite preview card from the
// sketchbook drawings.
//
//   pnpm build                                   # packages (design tokens, i18n)
//   pnpm --filter @driver/ui gallery             # → packages/ui/gallery-dist
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node apps/customer/scripts/stickers-export.mjs [out-dir]
//
// Reads each drawing from the gallery's `#stickers` page (`sticker-art-<id>`), and in the browser
// composes a 512×512 sticker: the drawing with a white die-cut rim and its Iraqi line in Marhey under
// it (the line from `sticker.line.<id>` in the Arabic locale). Writes, into apps/customer/assets/stickers/
// (or out-dir): `<id>.webp` (each under WhatsApp's 100 KB), `tray.png` (96×96, under 50 KB) and
// `contents.json` (WhatsApp's sticker-pack metadata: identifier, name, publisher, tray, stickers with
// their emojis). Also writes apps/customer/public/invite-card.png (1200×630, the /i/<code> preview).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../..');
const dist = join(repo, 'packages/ui/gallery-dist');
const outDir = resolve(process.argv[2] ?? join(here, '../assets/stickers'));
const publicDir = join(here, '../public');
if (!existsSync(join(dist, 'index.html'))) throw new Error('No gallery build: run `pnpm --filter @driver/ui gallery` first');
mkdirSync(outDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

const { STICKERS, STICKER_PACK } = await loadStickers();
const { art } = await import(pathToFileURL(join(repo, 'packages/design-tokens/dist/index.js')).href);
const ar = JSON.parse(readFileSync(join(repo, 'packages/i18n/src/locales/ar-IQ.json'), 'utf8'));
const requireHere = createRequire(join(here, '../package.json'));
const marhey = readFileSync(requireHere.resolve('@expo-google-fonts/marhey/700Bold/Marhey_700Bold.ttf')).toString('base64');

/** The manifest is TypeScript in @driver/ui: read it as data (ids, art, emojis) without a TS loader. */
async function loadStickers() {
  const src = readFileSync(join(repo, 'packages/ui/src/art/stickers.ts'), 'utf8');
  const list = src.slice(src.indexOf('export const STICKERS'), src.indexOf('];', src.indexOf('export const STICKERS')) + 1);
  const pack = src.slice(src.indexOf('export const STICKER_PACK'), src.indexOf('} as const;', src.indexOf('export const STICKER_PACK')) + 1);
  const STICKERS = Function(`return ${list.slice(list.indexOf('['))}`)();
  const STICKER_PACK = Function(`return ${pack.slice(pack.indexOf('{')).replace(/\/\*\*[\s\S]*?\*\//g, '')}`)();
  return { STICKERS, STICKER_PACK };
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  const file = existsSync(path) && !path.endsWith('/') ? path : join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  await page.goto(`${origin}/#stickers`, { waitUntil: 'load' });
  await page.locator(`[data-testid="sticker-art-${STICKERS[0].id}"] svg`).first().waitFor({ timeout: 20_000 });

  const svgs = await page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const svg = document.querySelector(`[data-testid="sticker-art-${id}"] svg`);
      const clone = svg.cloneNode(true);
      const box = svg.getBoundingClientRect();
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(Math.round(box.width)));
      clone.setAttribute('height', String(Math.round(box.height)));
      out[id] = new XMLSerializer().serializeToString(clone);
    }
    return out;
  }, STICKERS.map((s) => s.id));

  const result = await page.evaluate(
    async ({ stickers, svgs, lines, font, pack, ink, paper, invite }) => {
      const face = new FontFace('MarheyExport', `url(data:font/ttf;base64,${font})`, { weight: '700' });
      await face.load();
      document.fonts.add(face);
      const load = (svg) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        });
      /** The drawing trimmed to its painted pixels (a dish sits small in its 200 box). */
      const trimmed = (img) => {
        const k = 3;
        const c = document.createElement('canvas');
        c.width = img.width * k;
        c.height = img.height * k;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, c.width, c.height);
        const { data } = x.getImageData(0, 0, c.width, c.height);
        let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
        for (let y = 0; y < c.height; y += 1)
          for (let i = 0; i < c.width; i += 1)
            if (data[(y * c.width + i) * 4 + 3] > 8) {
              if (i < minX) minX = i;
              if (i > maxX) maxX = i;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
        const out = document.createElement('canvas');
        out.width = maxX - minX + 1;
        out.height = maxY - minY + 1;
        out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
        return out;
      };
      /** The drawing with a white die-cut rim, scaled to fit `w`×`h`, centred at (cx, top). */
      const cut = (ctx, source, cx, top, w, h, rim) => {
        const img = trimmed(source);
        const scale = Math.min(w / img.width, h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const sil = document.createElement('canvas');
        sil.width = Math.ceil(dw);
        sil.height = Math.ceil(dh);
        const s = sil.getContext('2d');
        s.drawImage(img, 0, 0, dw, dh);
        s.globalCompositeOperation = 'source-in';
        s.fillStyle = '#FFFFFF';
        s.fillRect(0, 0, dw, dh);
        const x = cx - dw / 2;
        for (let a = 0; a < 360; a += 15) ctx.drawImage(sil, x + rim * Math.cos((a * Math.PI) / 180), top + rim * Math.sin((a * Math.PI) / 180));
        ctx.drawImage(img, x, top, dw, dh);
        return dh;
      };
      const label = (ctx, text, cx, y, size) => {
        ctx.font = `700 ${size}px MarheyExport`;
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.28;
        ctx.strokeStyle = '#FFFFFF';
        ctx.strokeText(text, cx, y);
        ctx.fillStyle = ink;
        ctx.fillText(text, cx, y);
      };
      const encode = (canvas, max) => {
        for (const q of [0.92, 0.85, 0.78, 0.7, 0.6, 0.5]) {
          const url = canvas.toDataURL('image/webp', q);
          const bytes = Math.floor((url.length - url.indexOf(',') - 1) * 0.75);
          if (bytes <= max) return { url, bytes, q };
        }
        throw new Error('sticker too large even at quality 0.5');
      };
      const out = { stickers: [], tray: null, invite: null };
      for (const st of stickers) {
        const img = await load(svgs[st.id]);
        const c = document.createElement('canvas');
        c.width = pack.size;
        c.height = pack.size;
        const ctx = c.getContext('2d');
        const isScene = 'scene' in st.art;
        // 16 px margin (WhatsApp's guide), the drawing on top, the line under it.
        const top = isScene ? 40 : 34;
        const dh = cut(ctx, img, pack.size / 2, top, pack.size - 64, isScene ? 300 : 320, 10);
        const text = lines[st.id];
        const size = [...text].length > 9 ? 70 : 84;
        label(ctx, text, pack.size / 2, Math.min(pack.size - 34, top + dh + size + 10), size);
        const { url, bytes, q } = encode(c, pack.maxStickerBytes);
        out.stickers.push({ id: st.id, url, bytes, q });
        if (st === stickers[0]) {
          const tray = document.createElement('canvas');
          tray.width = pack.traySize;
          tray.height = pack.traySize;
          cut(tray.getContext('2d'), img, pack.traySize / 2, 6, pack.traySize - 12, pack.traySize - 12, 3);
          out.tray = tray.toDataURL('image/png');
        }
      }
      // The invite preview card (1200×630): paper, the treat tray, the friend's line, the brand.
      const card = document.createElement('canvas');
      card.width = 1200;
      card.height = 630;
      const cc = card.getContext('2d');
      cc.fillStyle = paper;
      cc.fillRect(0, 0, 1200, 630);
      const trayImg = await load(svgs[invite.art]);
      cut(cc, trayImg, 300, 95, 440, 440, 12);
      cc.font = '700 76px MarheyExport';
      cc.direction = 'rtl';
      cc.textAlign = 'right';
      cc.fillStyle = ink;
      const words = invite.title.split(' ');
      const mid = Math.ceil(words.length / 2);
      cc.fillText(words.slice(0, mid).join(' '), 1120, 260);
      cc.fillText(words.slice(mid).join(' '), 1120, 360);
      cc.font = '700 40px MarheyExport';
      cc.fillStyle = '#B5521B';
      cc.fillText(invite.brand, 1120, 470);
      out.invite = card.toDataURL('image/png');
      return out;
    },
    {
      stickers: STICKERS,
      svgs,
      lines: Object.fromEntries(STICKERS.map((s) => [s.id, ar[`sticker.line.${s.id}`]])),
      font: marhey,
      pack: STICKER_PACK,
      ink: art.line,
      paper: art.paper,
      invite: { art: 'bil_afia', title: ar['invite.landing_title_anon'], brand: ar['sharecard.brand'] },
    },
  );

  const write = (file, dataUrl) => {
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    writeFileSync(file, buf);
    return buf.length;
  };
  for (const s of result.stickers) {
    const bytes = write(join(outDir, `${s.id}.webp`), s.url);
    console.log(`${s.id}.webp ${(bytes / 1024).toFixed(1)} KB (q ${s.q})`);
  }
  const trayBytes = write(join(outDir, STICKER_PACK.trayFile), result.tray);
  if (trayBytes > STICKER_PACK.maxTrayBytes) throw new Error(`tray ${trayBytes} B is over WhatsApp's limit`);
  console.log(`${STICKER_PACK.trayFile} ${(trayBytes / 1024).toFixed(1)} KB`);
  write(join(publicDir, 'invite-card.png'), result.invite);
  console.log('public/invite-card.png');
  const contents = {
    android_play_store_link: '',
    ios_app_store_link: '',
    sticker_packs: [
      {
        identifier: STICKER_PACK.identifier,
        name: STICKER_PACK.name,
        publisher: STICKER_PACK.publisher,
        tray_image_file: STICKER_PACK.trayFile,
        image_data_version: STICKER_PACK.imageDataVersion,
        avoid_cache: false,
        animated_sticker_pack: false,
        publisher_email: '',
        publisher_website: '',
        privacy_policy_website: '',
        license_agreement_website: '',
        stickers: STICKERS.map((s) => ({ image_file: `${s.id}.webp`, emojis: s.emojis, accessibility_text: ar[`sticker.line.${s.id}`] })),
      },
    ],
  };
  writeFileSync(join(outDir, 'contents.json'), `${JSON.stringify(contents, null, 2)}\n`);
  console.log('contents.json');
} finally {
  await browser.close();
  server.close();
}
