# Customer web app on Vercel

Ali chose Vercel for the customer web app (2026-10-07). It is the same static export as the
Cloudflare Pages route in [web.md](web.md); only the host differs. The API stays on Fly.

- Vercel project `driver-customer` (Ali's account), linked to this GitHub repo, **Root Directory
  `apps/customer`**. Settings live in `apps/customer/vercel.json`; the build is
  `apps/customer/scripts/vercel-build.sh` (builds the shared packages, `expo export`, then the same
  `prepare-web.mjs` checks).
- Project environment variable `EXPO_PUBLIC_API_URL` = the **staging** API
  (`https://driver-api-staging.fly.dev/trpc`) until launch. It is baked in at build time: change it,
  then redeploy. `EXPO_PUBLIC_SHARE_BASE_URL` defaults to the project's own address.
- Vercel deploys by itself on every push, but `ignoreCommand` lets only `main` (and this feature's
  branch while it is open) build, so other PR branches don't queue builds.
- Deep links (`/share/<token>`, `/order/<id>`) fall back to `index.html`; `/i/<code>` gets
  `invite.html` (the WhatsApp preview card). Headers match the Cloudflare `_headers`.
- Plan: the free Hobby plan is for non-commercial use. Move to Pro before real customers order.
- Own domain later: Vercel project → Domains → `app.<domain>`, then update the API's `CORS_ORIGINS`.
