// Draws the web app's home-screen icons (public/icons/*.png) from the placeholder wordmark
// (src/components/Wordmark.tsx: «درايفر» in accentText with an accent dot, on the cream bg), and the
// first-paint mark that public/index.html carries inline (between the splash-mark comments), so a first
// visit shows the brand before the app's code has downloaded.
// Re-run when the brand symbol is chosen (docs/before-launch.md), after changing the drawing below.
//
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
//     node scripts/web-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { themes } from '@driver/design-tokens';

const require = createRequire(import.meta.url);
const font = readFileSync(require.resolve('@expo-google-fonts/ibm-plex-sans-arabic/700Bold/IBMPlexSansArabic_700Bold.ttf')).toString('base64');
const { bg, accent, accentText } = themes.light;

// `inset` = share of the side kept clear around the wordmark (maskable icons are cut to a circle).
const icons = [
  { file: 'icon-192.png', size: 192, inset: 0.14 },
  { file: 'icon-512.png', size: 512, inset: 0.14 },
  { file: 'maskable-512.png', size: 512, inset: 0.24 },
  { file: 'apple-touch-icon.png', size: 180, inset: 0.14 },
];

const page = (size, inset) => {
  const fs = size * (1 - inset * 2) * 0.3; // Wordmark proportions: dot 0.22×, raised 0.42×
  return `<!doctype html><html dir="rtl"><head><style>
@font-face { font-family: Plex; src: url(data:font/ttf;base64,${font}); }
html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${bg}; }
body { display: flex; align-items: center; justify-content: center; }
.mark { display: flex; flex-direction: row; align-items: flex-end; gap: ${fs * 0.1}px; }
.word { font: 700 ${fs}px/1.5 Plex; color: ${accentText}; }
.dot { width: ${fs * 0.22}px; height: ${fs * 0.22}px; border-radius: 50%; background: ${accent}; margin-bottom: ${fs * 0.42}px; }
</style></head><body><div class="mark"><span class="word">درايفر</span><span class="dot"></span></div></body></html>`;
};

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
for (const { file, size, inset } of icons) {
  const tab = await browser.newPage({ viewport: { width: size, height: size } });
  await tab.setContent(page(size, inset));
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: new URL(`../public/icons/${file}`, import.meta.url).pathname });
  await tab.close();
  console.log(`✔ public/icons/${file}`);
}

// The first-paint mark: the wordmark alone on a clear background, 2× for sharp phone screens.
const SPLASH_FS = 40;
const tab = await browser.newPage({ viewport: { width: 320, height: 320 }, deviceScaleFactor: 2 });
await tab.setContent(page(320, 0.5 - (SPLASH_FS / 0.3 / 320) / 2).replace(`background: ${bg};`, 'background: transparent;'));
await tab.evaluate(() => document.fonts.ready);
const png = await tab.locator('.mark').screenshot({ omitBackground: true });
await tab.close();
const htmlPath = new URL('../public/index.html', import.meta.url);
const html = readFileSync(htmlPath, 'utf8').replace(
  /(<!-- splash-mark -->)[\s\S]*?(<!-- \/splash-mark -->)/,
  `$1<img src="data:image/png;base64,${png.toString('base64')}" alt="درايفر" height="${SPLASH_FS * 1.5}" />$2`,
);
writeFileSync(htmlPath, html);
console.log(`✔ first-paint mark (${png.length} bytes) inlined in public/index.html`);
await browser.close();
