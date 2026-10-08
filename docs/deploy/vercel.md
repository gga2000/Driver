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
- Only `main` deploys. `git.deploymentEnabled` in vercel.json stops every other branch from even creating a
  deployment (the free plan allows 100 deployments a day, and ignored builds still count), and the
  project setting "preview deployments disabled" covers branches cut before that line existed.
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

## Live check

`.github/workflows/web-smoke.yml` opens the live site in a real browser after every production deploy
(Vercel reports it to GitHub as a deployment) and every 6 hours, using `scripts/deploy/web-smoke.mjs`:
the page draws with no script error, the API answers a call from that origin (so a missing
`CORS_ORIGINS` entry shows up here), and the customer manifest and icons are served. A red run emails
the repo owner. Once the restaurant site has its address, set the repo variable `MERCHANT_WEB_URL` so
the timed run checks it too. Run it by hand: Actions → Web live check → Run workflow.
