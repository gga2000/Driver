// Screenshots the built gallery (gallery-dist) at phone and desktop widths.
// Usage: PLAYWRIGHT_MODULE=/path/to/node_modules/playwright CHROMIUM_PATH=/path/to/chrome \
//        node gallery/screenshot.mjs <out-dir>
// Long pages are cut into several numbered slices: ui-gallery-<width>-<n>.png.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(here, '../gallery-dist');
const outDir = resolve(process.argv[2] ?? join(here, '../gallery-shots'));
mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  const file = existsSync(path) && !path.endsWith('/') ? path : join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const errors = [];
for (const [label, width, slice] of [
  ['390', 390, 1700],
  ['1280', 1280, 1100],
]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('findDOMNode') && errors.push(`[${label}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.stack ?? e.message}`));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  // The RN ScrollView owns scrolling: grow the viewport to the content height instead.
  const contentHeight = await page.evaluate(() => {
    let max = document.documentElement.scrollHeight;
    for (const el of document.querySelectorAll('div')) {
      const s = getComputedStyle(el);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') max = Math.max(max, el.scrollHeight);
    }
    return max;
  });
  await page.setViewportSize({ width, height: contentHeight });
  await page.waitForTimeout(600);
  // Real horizontal overflow: the page or the RN scroll container is wider than the viewport.
  // (Clipped children such as the skeleton shimmer band don't count.)
  const overflowX = await page.evaluate(() => {
    const out = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) out.push(`document ${root.scrollWidth}px > ${root.clientWidth}px`);
    for (const el of document.querySelectorAll('div')) {
      const s = getComputedStyle(el);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        out.push(`scroll container ${el.scrollWidth}px > ${el.clientWidth}px`);
      }
    }
    return out;
  });
  if (overflowX.length) errors.push(`[${label}] horizontal overflow:\n  ` + overflowX.join('\n  '));
  const height = contentHeight;
  let n = 1;
  for (let y = 0; y < height; y += slice, n++) {
    const file = join(outDir, `ui-gallery-${label}-${n}.png`);
    await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y, width, height: Math.min(slice, height - y) } });
    console.log(file);
  }
  await page.close();
}
await browser.close();
server.close();
if (errors.length) {
  console.error('Console errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}
