/* The customer website's service worker (speed idea w6, docs/deploy/vercel.md "Offline and new versions").
 * A template: scripts/web-offline.mjs fills BUILD and PRECACHE after `expo export` and writes it to
 * dist-web/sw.js. What it does, in order of importance:
 *  - Pages (index.html for every path) come from the network first, always. The cached copy is used
 *    only when the network fails, so nobody is ever kept on an old version while they are online.
 *  - Hashed files (/_expo/static/…, /assets/…) never change under their name: served from the cache,
 *    fetched and kept the first time. On install it keeps this version's shell and screens, so the app
 *    opens with no network and shows its own «النت مقطوع» strip instead of the browser's error page.
 *  - Each new version takes over at once and deletes the files the old one kept.
 * Never touched: other sites (the API), anything but GET, /sw.js and /version.json. */
const BUILD = '%BUILD%';
const PRECACHE = /* %PRECACHE% */ [];
const SHELL = `driver-shell-${BUILD}`;
const FILES = `driver-files-${BUILD}`;
const PAGE = '/index.html';

const isHashed = (path) => path.startsWith('/_expo/static/') || path.startsWith('/assets/');

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // The page must be this version's (a deploy can land between the two downloads): if not, the
      // install fails and the browser tries again with the newer sw.js.
      const page = await fetch(new Request(PAGE, { cache: 'reload' }));
      if (!page.ok || !(await page.clone().text()).includes(`content="${BUILD}"`))
        throw new Error('page and worker are different versions');
      await (await caches.open(SHELL)).put(PAGE, page);
      const files = await caches.open(FILES);
      // Screens are kept too unless the phone asked to save data; they are fetched on first use then.
      const saveData = self.navigator.connection && self.navigator.connection.saveData;
      await files.addAll(
        saveData ? PRECACHE.filter((f) => f.shell).map((f) => f.url) : PRECACHE.map((f) => f.url),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('driver-') && name !== SHELL && name !== FILES)
          await caches.delete(name);
      }
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname === '/sw.js' ||
    url.pathname === '/version.json'
  )
    return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          return preloaded || (await fetch(req));
        } catch {
          const cached = await caches.match(PAGE, { cacheName: SHELL });
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  if (isHashed(url.pathname)) {
    event.respondWith(
      (async () => {
        const files = await caches.open(FILES);
        const cached = await files.match(req, { ignoreVary: true });
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') event.waitUntil(files.put(req, res.clone()));
        return res;
      })(),
    );
  }
});
