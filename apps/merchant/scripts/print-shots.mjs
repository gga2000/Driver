// Renders every printed ticket (kitchen, slip, gift, stub, reprint, change, cups, stations, ruler) at
// 58 and 80 mm into PNGs at the printer's own resolution (8 dots per mm, 203 dpi), plus a 1-bit copy
// of each the way a thermal head prints it (no grey).
//
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
//     node apps/merchant/scripts/print-shots.mjs <out-dir>
//
// Step 1 writes the pages with the unit test (`src/print/shots.test.ts`, PRINT_SHOTS_DIR); step 2
// screenshots each paper.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const app = resolve(here, '..');
const outDir = resolve(process.argv[2] ?? join(app, 'print-shots'));
const pages = join(outDir, 'pages');
mkdirSync(pages, { recursive: true });

execFileSync('npx', ['vitest', 'run', 'src/print/shots.test.ts'], { cwd: app, stdio: 'inherit', env: { ...process.env, PRINT_SHOTS_DIR: pages } });

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--allow-file-access-from-files'] });
// 1 mm = 3.7795 CSS px; 8 device px per mm = the printer's dots.
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 8 / 3.7795 });
const files = readdirSync(pages).filter((f) => f.endsWith('.html')).sort();
for (const f of files) {
  await page.goto(pathToFileURL(join(pages, f)).href);
  await page.evaluate(() => document.fonts.ready);
  const papers = page.locator('.paper');
  const n = await papers.count();
  for (let i = 0; i < n; i += 1) {
    const name = f.replace(/\.html$/, '') + (n > 1 ? `-${i + 1}` : '');
    await papers.nth(i).screenshot({ path: join(outDir, `${name}.png`) });
    // The same paper as 1-bit dots: what the thermal head actually burns.
    const dots = await papers.nth(i).evaluate(async (el) => {
      el.style.filter = 'grayscale(1) contrast(100)';
      await new Promise((r) => setTimeout(r, 50));
      return true;
    });
    if (dots) await papers.nth(i).screenshot({ path: join(outDir, `${name}.dots.png`) });
    await papers.nth(i).evaluate((el) => {
      el.style.filter = '';
    });
  }
  console.log(`${f}: ${n} paper(s)`);
}
await browser.close();
