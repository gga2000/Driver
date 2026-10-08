# Console (dispatch, support, finance, ops): Next.js on Fly

The Console (`apps/console`) is a Next.js app whose pages all run in the browser: sign-in, data and
actions all go from the staff member's browser straight to the API. The Next server only serves the
pages. So it needs no secrets, no database access and almost no server.

**Host: Fly, app `driver-console`, Frankfurt, one machine always on** (`deploy/fly/console.toml`):
about $2/month, so a dispatcher at night never waits for a ~2 s cold start. Same account and same
deploy workflow as the API.

Why not Vercel: it is the most convenient host for Next.js, but its free Hobby plan is for
non-commercial use only and Pro is $20/month per member — a lot for a staff tool with five users. If
you prefer it anyway, it works unchanged: import the repo, root directory `apps/console`, set
`NEXT_PUBLIC_API_URL`.

## Build

`apps/console/Dockerfile` (build from the repository root) runs `next build` with
`NEXT_OUTPUT=standalone`, which makes `next.config.ts` emit a self-contained server
(`outputFileTracingRoot` = the monorepo root), and ships only that server and its static files
(~90 MB). `NEXT_PUBLIC_API_URL` is a **build argument**: it is baked into the browser bundle, so change
it by rebuilding. `NEXT_PUBLIC_SENTRY_DSN` (optional build argument, from the GitHub variable
`SENTRY_DSN`, or `SENTRY_DSN_CONSOLE` to override it) turns on crash reports ([hosting.md](hosting.md) "Logs and errors"). CI's normal
`next build` is unaffected (no `NEXT_OUTPUT`). Checked on 2026-10-04: the
standalone build serves `/login` and `/orders/<id>` with the headers below.

Every response carries `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin` and
`X-Robots-Tag: noindex` (staff tool: never framed, never indexed).

## One-time setup

```bash
fly apps create driver-console
fly deploy . --config deploy/fly/console.toml --dockerfile apps/console/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://driver-api.fly.dev/trpc --remote-only
```

Then in GitHub add the variable `FLY_CONSOLE_APP` = `driver-console` (and use an org-wide
`FLY_API_TOKEN`, `fly tokens create org`), and the deploy workflow ships it after the API.
Own domain: `fly certs add console.<domain> --config deploy/fly/console.toml`, then add it to the API's
`CORS_ORIGINS`.

## Sign-in and access (auth notes)

- Staff sign in with their phone and a one-time code, like customers. What they can see and do comes
  from their **roles** (`dispatcher`, `support`, `finance`, `admin`, `field_ops`) on the server; the
  Console only hides buttons, the API enforces every permission.
- The first admin is created by the production seed (`SEED_ADMIN_PHONE`, [supabase.md](supabase.md));
  that admin grants roles to the rest of the team.
- The session (access + refresh token) is kept in the browser's localStorage. Consequences: use the
  Console only on staff devices; sign out on shared computers; never install browser extensions you do
  not trust on those machines. Moving the refresh token into an httpOnly cookie needs a small
  Console backend (planned, see `apps/console/src/lib/session.ts`).
- The dev-only "show OTP" helper is compiled out of production builds (`NODE_ENV=production`) and the
  API refuses `devLastOtp` in production.
- Until a real SMS provider is configured the API runs `SMS_PROVIDER=fake` and writes codes to its log
  ([runbook.md](runbook.md#before-sms-exists)).
