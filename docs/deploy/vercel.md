# Web apps on Vercel (customer and restaurant)

Ali chose Vercel for the customer web app (2026-10-07). It is the same static export as the
Cloudflare Pages route in [web.md](web.md); only the host differs. The API stays on Fly.

- Vercel project `driver-customer` (Ali's account), linked to this GitHub repo, **Root Directory
  `apps/customer`**. Settings live in `apps/customer/vercel.json`; the build is
  `apps/customer/scripts/vercel-build.sh` (builds the shared packages, `expo export`, then the same
  `prepare-web.mjs` checks).
- Project environment variable `EXPO_PUBLIC_API_URL` = the **staging** API
  (`https://driver-api-staging.fly.dev/trpc`) until launch. It is baked in at build time: change it,
  then redeploy. `EXPO_PUBLIC_SHARE_BASE_URL` defaults to the project's own address.
- No push deploys. `git.deploymentEnabled: false` in vercel.json means a merge to `main` (or any other
  branch) creates no deployment, so the websites never ship ahead of the API they call. A release
  deploys them from the **Deploy** workflow (`.github/workflows/deploy.yml`, job `web-vercel`), after
  the API passed its smoke test, by calling each project's **deploy hook**; the hook builds the newest
  commit of `main`, so the job refuses any other commit. The project setting "preview deployments
  disabled" stays on.
- Deploy hooks (Ali, once per project): Vercel → the project → Settings → Git → **Deploy Hooks** →
  name `release`, branch `main` → Create. Copy the URL straight into GitHub → Settings → Environments
  → `production` → Add secret: `VERCEL_DEPLOY_HOOK_CUSTOMER` (customer project) and
  `VERCEL_DEPLOY_HOOK_MERCHANT` (restaurant project). The URL is a secret: anyone who has it can start a
  build. Without them the Deploy run skips the websites with a notice.
- Roll back: Vercel → the project → Deployments → the previous production one → **Instant Rollback**
  ([runbook.md](runbook.md)).
- Deep links (`/share/<token>`, `/order/<id>`) fall back to `index.html`; `/i/<code>` gets
  `invite.html` (the WhatsApp preview card). Headers match the Cloudflare `_headers`.
- Plan: the free Hobby plan is for non-commercial use. Move to Pro before real customers order.
- Own domain later: Vercel project → Domains → `app.<domain>`, then update the API's `CORS_ORIGINS`.

## Restaurant (merchant) web app

Same setup as a second Vercel project, `driver-merchant`, Root Directory **`apps/merchant`**
(`apps/merchant/vercel.json`, `apps/merchant/scripts/vercel-build.sh`), same `EXPO_PUBLIC_API_URL`.
Its address must also be in the staging API's `CORS_ORIGINS`. Every page is `noindex` (staff tool).
On the web: no Bluetooth printer (the printer screen says so), no push, the order sound starts after
the «ابدأ الشغل» tap (browser autoplay rule), keep-screen-on uses Wake Lock when the browser allows it.

## Add to home screen (customer)

The customer site is an installable web app: `apps/customer/public/index.html` (the page shell:
`lang="ar" dir="rtl"`, manifest and icon links, iOS meta tags), `public/manifest.webmanifest` and
`public/icons/*.png`. The icons are the placeholder wordmark drawn by `apps/customer/scripts/web-icons.mjs`;
re-run it when the brand symbol is chosen. Colours are the theme's cream `bg`;
`src/lib/web-shell.test.ts` keeps app.json, the manifest and the tokens in step.

First paint: `index.html` itself carries a cream background, the wordmark (a small inline picture, also
drawn by `web-icons.mjs`) and «لحظة…» inside `#root`, so a first visit shows the brand at once instead
of a white page while the 1 MB app downloads (4 s on Iraqi 4G, up to 24 s on weak 3G). The app
replaces it when it draws.

## Split per screen, offline and new versions (customer)

Each screen's code is its own file on the website (app.json, the expo-router plugin's
`asyncRoutes: { web: "production" }`; the phone apps are not split): a first visit downloads only the
shared code and the screen it opens, about 200 KB less (home 1,328 → 1,132 KB compressed, 5.8 → 4.3 s
on slow 4G with a slow phone). Every other screen loads when it is first opened.

`apps/customer/scripts/web-offline.mjs` runs after the export (in `vercel-build.sh`) and:
- names the version (from the exported `index.html`) in the page (`<meta name="driver-build">`) and in
  `/version.json`;
- writes `/sw.js` (from `apps/customer/web/sw.js`), the offline worker. Pages always come from the
  network first; the kept copy is used only when the network fails, so the app still opens with no
  internet and shows its own «النت مقطوع» strip. The hashed files are kept on the phone (the first
  bundles and every screen but the map library; only the first bundles when the phone saves data).
  Each new version takes over at once and deletes what the old one kept.

An open tab never stays on an old version (`src/lib/web-build.ts`): when it comes back to the front, and
every 15 minutes, it reads `/version.json`; once a newer version is out, the next move to another screen
loads it fresh (the cart and the sign-in are kept). A screen whose code no longer exists (an old tab
after a deploy) or didn't download reloads the page once instead of showing «صار خلل». The phone apps'
«حدّث التطبيق» (the server's `update_required`) is unchanged: the website sends no build header and is
never turned away, because it is always the newest version.

If the worker ever misbehaves: set `WEB_OFFLINE=off` in the Vercel project and redeploy. The next
`/sw.js` deletes its caches and unregisters itself on every phone that had it.

## Live check

`.github/workflows/web-smoke.yml` opens the live site in a real browser after every production deploy
(Vercel reports it to GitHub as a deployment) and every 6 hours, using `scripts/deploy/web-smoke.mjs`:
the page draws with no script error, the API answers a call from that origin (so a missing
`CORS_ORIGINS` entry shows up here), and the customer manifest and icons are served. A red run emails
the repo owner. It always checks the public addresses (driver-customer-iota.vercel.app and
driver-merchant.vercel.app), never a deploy's one-off address, which the API rightly refuses. If the
restaurant site moves to its own domain, set the repo variable `MERCHANT_WEB_URL`. Run it by hand: Actions → Web live check → Run workflow.
