import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Every Console page, in both themes and at both laptop sizes (gate C10, CON-13): it draws without
 * a page error or a CSP violation, it is Arabic and right-to-left, axe finds nothing serious or
 * critical, and a screenshot lands in e2e/.shots for review.
 */
const PAGES = ['/', '/map', '/dispatch', '/orders', '/drivers', '/safety', '/on-call', '/support', '/approvals', '/stores', '/finance', '/pricing', '/controls', '/wall', '/zones', '/system'];
const SIZES = [
  { w: 1440, h: 900 },
  { w: 1366, h: 768 },
];
const THEMES = ['light', 'dark'] as const;
/**
 * Findings on screens this lane doesn't own, each with its owner and where it was handed over. The
 * test fails if one of these disappears (so the list can't go stale) or anything else appears.
 */
const KNOWN: Record<string, { rule: string; owner: string }[]> = {
  // Zone list rename/delete icons are 20 px; the zones page belongs to the map session (CLAUDE.md).
  '/zones': [{ rule: 'target-size', owner: 'map session (relayed 2026-10-07)' }],
};
/** Every string key: one showing raw on screen means a missing string (or one the build's subset dropped). */
const KEYS = new Set(Object.keys(JSON.parse(readFileSync(join(__dirname, '../../../packages/i18n/src/locales/ar-IQ.json'), 'utf8'))));
const SETTLE_MS = Number(process.env.E2E_SETTLE_MS ?? 2500);

/** Outside hosts the sandbox or CI can't reach (map tiles); everything else is a real error. */
const IGNORED_CONSOLE = /Failed to load resource|ERR_TUNNEL|tile\.openstreetmap|ERR_NAME_NOT_RESOLVED/;

async function open(page: Page, path: string, theme: (typeof THEMES)[number]) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED_CONSOLE.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('driver.console.theme', t);
    } catch {
      /* storage blocked */
    }
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  }, theme);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.locator('#main').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SETTLE_MS);
  const csp = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  return { problems, csp };
}

for (const theme of THEMES) {
  for (const size of SIZES) {
    test.describe(`${theme} ${size.w}×${size.h}`, () => {
      test.use({ viewport: { width: size.w, height: size.h } });
      for (const path of PAGES) {
        test(`${path} draws cleanly`, async ({ page }) => {
          const { problems, csp } = await open(page, path, theme);
          await expect(page).not.toHaveURL(/\/login/);
          await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
          await expect(page.locator('html')).toHaveAttribute('lang', /^ar/);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          expect(csp, 'CSP violations').toEqual([]);
          expect(problems, 'page errors').toEqual([]);
          const text = await page.locator('body').innerText();
          const raw = [...new Set(text.match(/[a-z_]+[.:][\w.:-]+/g) ?? [])].filter((w) => KEYS.has(w));
          expect(raw, 'string keys showing raw').toEqual([]);

          const dir = `e2e/.shots/${theme}-${size.w}`;
          mkdirSync(dir, { recursive: true });
          await page.screenshot({ path: `${dir}/${path === '/' ? 'home' : path.slice(1)}.png` });

          // axe once per page and theme (layout size doesn't change contrast or names).
          if (size.w === 1440) {
            const axe = await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
              // The map canvas is a picture; its labels and controls are checked as DOM elsewhere.
              .exclude('.maplibregl-canvas')
              .analyze();
            const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
            const known = (KNOWN[path] ?? []).map((k) => k.rule);
            const bad = serious
              .filter((v) => !known.includes(v.id))
              .map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`);
            expect(bad, 'axe serious/critical').toEqual([]);
            for (const k of known) expect(serious.map((v) => v.id), `known finding ${k} is fixed: remove it from KNOWN`).toContain(k);
          }
        });
      }
    });
  }
}

test('keyboard: the first Tab is "skip to content", and it lands in the page', async ({ page }) => {
  await open(page, '/orders', 'light');
  await page.keyboard.press('Tab');
  const skip = page.locator(':focus');
  await expect(skip).toHaveAttribute('href', '#main');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});
