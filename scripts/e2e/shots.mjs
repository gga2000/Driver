// Screenshots for scripts/e2e/three-apps.mjs: the three web builds (apps/<app>/dist-e2e, exported
// against the e2e API) served locally, one browser context per signed-in person, and at every step
// the same order captured in each app: <dir>/<step>-<app>.png.
//
// Sessions are the token pairs the walk signed in with, written to each app's storage key before the
// app boots — the same thing the OTP screen stores — so the apps hydrate signed in.

const SESSION_KEYS = { customer: 'driver.customer.session', partner: 'driver.partner.session', merchant: 'driver.merchant.session' };
const VIEWPORTS = { customer: { width: 390, height: 844 }, partner: { width: 390, height: 844 }, merchant: { width: 1280, height: 800 } };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
// Map tiles are blocked in the sandbox; React Native Web's deprecation noise is not an app error.
const NOISE = /findDOMNode|DevTools|props\.pointerEvents|shadow\*|WebSocket connection|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION|Failed to load resource/;

export async function setupShots({ root, dir, people, existsSync, mkdirSync, readFileSync, createServer, extname, join }) {
  mkdirSync(dir, { recursive: true });
  const servers = [];
  const origins = {};
  for (const app of ['customer', 'partner', 'merchant']) {
    const dist = join(root, 'apps', app, process.env[`${app.toUpperCase()}_DIST`] ?? 'dist-e2e');
    if (!existsSync(join(dist, 'index.html'))) throw new Error(`No web export at ${dist} (export it against http://127.0.0.1:3340/trpc)`);
    const server = createServer((req, res) => {
      const path = join(dist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
      const file = existsSync(path) && !path.endsWith('/') && extname(path) ? path : join(dist, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    origins[app] = `http://127.0.0.1:${server.address().port}`;
  }

  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const pages = new Map();
  const errors = [];

  async function pageFor(app, personKey) {
    const key = `${app}:${personKey}`;
    if (pages.has(key)) return pages.get(key);
    const p = people[personKey];
    const context = await browser.newContext({ viewport: VIEWPORTS[app], deviceScaleFactor: 2, locale: 'ar-IQ', timezoneId: 'Asia/Baghdad' });
    const stored = {
      accessToken: p.tokens.accessToken,
      refreshToken: p.tokens.refreshToken,
      accessExpiresAt: new Date(p.tokens.accessExpiresAt).toISOString(),
      refreshExpiresAt: new Date(p.tokens.refreshExpiresAt).toISOString(),
      personId: p.personId,
    };
    await context.addInitScript(([k, v]) => {
      if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, v);
    }, [SESSION_KEYS[app], JSON.stringify(stored)]);
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(`[${key}] ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`[${key}] ${e.stack ?? e.message}`));
    pages.set(key, page);
    return page;
  }

  /**
   * `views`: { customer: path, merchant: path, partner: path, partnerAs?: personKey, order?: apps }.
   * A path of '@current' screenshots the page where the app itself navigated (the offer card the
   * Partner app pushes when an offer arrives) without reloading it.
   */
  async function capture(step, views) {
    for (const app of views.order ?? ['customer', 'merchant', 'partner']) {
      const path = views[app];
      if (!path) continue;
      const personKey = app === 'customer' ? 'customer' : app === 'merchant' ? 'owner' : (views.partnerAs ?? 'courier');
      const page = await pageFor(app, personKey);
      if (path === '@current') await page.waitForTimeout(1200);
      else {
        await page.goto(`${origins[app]}${path}`, { waitUntil: 'networkidle' }).catch(() => undefined);
        await page.evaluate(() => document.fonts.ready).catch(() => undefined);
        await page.waitForTimeout(Number(process.env.SHOT_SETTLE_MS ?? 2500));
      }
      const file = join(dir, `${step}-${app}.png`);
      await page.screenshot({ path: file });
      console.log(`  ▣ ${file}`);
    }
  }

  async function close() {
    await browser.close();
    for (const s of servers) s.close();
    if (errors.length) {
      console.log(`\nBrowser console errors (${errors.length}):`);
      for (const e of errors.slice(0, 40)) console.log(`  ${e.split('\n')[0]}`);
    }
  }

  return { capture, close, errors };
}
