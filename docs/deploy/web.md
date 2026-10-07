# Web apps: customer (and partner, merchant) on Cloudflare Pages

The three Expo apps also build for the web (`expo export --platform web`). The customer web app is what
opens when someone taps a shared trip link (`/share/<token>`, no sign-in). The merchant web app is handy
on a restaurant's tablet or laptop; the partner one is optional (couriers use the phone app).

**Host: Cloudflare Pages** — free, unlimited bandwidth, a fast edge in the region, HTTPS, and it serves
`index.html` for every unknown path (single-page app fallback) so deep links work. Any static host
works the same way (Fly with a small static server, Netlify, S3 + CloudFront); only the `_headers` file
is Cloudflare/Netlify syntax.

## How a build works

```bash
EXPO_PUBLIC_API_URL=https://driver-api.fly.dev/trpc \
EXPO_PUBLIC_SHARE_BASE_URL=https://driver-customer.pages.dev \
  pnpm --filter @driver/customer web:export                        # → apps/customer/dist-web

node scripts/deploy/prepare-web.mjs apps/customer/dist-web --api-url https://driver-api.fly.dev/trpc
```

- `EXPO_PUBLIC_*` values are **baked into the bundle at build time**. Changing the API URL means
  rebuilding (the deploy workflow does it every time).
- `EXPO_PUBLIC_SHARE_BASE_URL` is the public address of the customer web app: share links created in
  the phone app point there.
- `EXPO_PUBLIC_SENTRY_DSN` (optional) turns on crash reports for that app; the deploy workflow takes it
  from the GitHub variable `SENTRY_DSN` (overridden per app by `SENTRY_DSN_CUSTOMER` / `_PARTNER` / `_MERCHANT`) ([hosting.md](hosting.md)
  "Logs and errors").
- `prepare-web.mjs` refuses a bundle that does not contain the API URL (or points at localhost), refuses
  a `404.html` (it would break the SPA fallback), and writes `_headers`:
  - `/_expo/static/*`, `/assets/*`: cached for a year (file names contain a hash, so a new build never
    serves an old file);
  - `/`, `/index.html`: `no-cache` (a new deploy is seen at once);
  - everywhere: `nosniff`, `X-Frame-Options: DENY`, a referrer policy, camera/location for this site only;
  - `/share/*`: `noindex` (trip links stay out of search engines) and `Referrer-Policy: no-referrer`
    (the token in the address is never sent to map tiles or other sites).
- Try it locally exactly as Pages will serve it:
  `node scripts/deploy/prepare-web.mjs apps/customer/dist-web --serve 8080` → <http://localhost:8080/share/anything>.

Checked on 2026-10-04: the customer export builds with the API URL inlined, and `/share/<token>` served
through the fallback renders the public share page without sign-in (with an unreachable API it shows
the "no connection, try again" state, as designed).

## One-time setup (10 minutes)

1. Cloudflare account (free) → **Workers & Pages** → **Create** → **Pages** → **Upload assets** →
   project name `driver-customer` → upload any small folder once to create it (the workflow replaces
   it). Repeat for `driver-merchant` (and `driver-partner` if wanted).
2. My Profile → **API Tokens** → **Create token** → template **Edit Cloudflare Workers** (or a custom
   token with *Account → Cloudflare Pages → Edit*). Copy it.
3. Copy your **Account ID** (Workers & Pages overview, right side).
4. GitHub → Settings → Secrets and variables → Actions:
   - secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`;
   - variables `API_PUBLIC_URL` (`https://driver-api.fly.dev/trpc`), `SHARE_BASE_URL`
     (`https://driver-customer.pages.dev`), `CF_PAGES_CUSTOMER` = `driver-customer`,
     `CF_PAGES_MERCHANT` = `driver-merchant`, `CF_PAGES_PARTNER` (leave empty to skip).
5. Run **Actions → Deploy → Run workflow → target: web**.

Your own domain later: Pages project → **Custom domains** → `app.<domain>` (and `merchant.<domain>`).
Then update `SHARE_BASE_URL`, the API's `CORS_ORIGINS`, and rebuild the phone apps (share links).

## Notes

- The web apps call the API from the browser: the API's CORS allows any origin until `CORS_ORIGINS` is
  set; set it once the domains are final.
- Photo uploads from the web go straight to Supabase Storage with a presigned URL; Supabase's S3
  endpoint accepts browser uploads. If an upload fails with a CORS error in the browser console, that
  is the place to look.
- The web build never contains secrets: everything `EXPO_PUBLIC_*` is public by definition.
