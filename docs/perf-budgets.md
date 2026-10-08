# Speed budgets

Every PR runs `.github/workflows/perf-budget.yml` (two jobs, "speed · app size" and "speed · screens stay
still"). The limits live in `scripts/perf/budgets.json`; the job summary shows a table of now / budget /
target for each number.

| Check         | What it measures                                                                                                                                                                           | Why it matters                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `size.mjs`    | Each phone app exported for Android (Hermes bytecode, with source maps as EAS does): code MB and pictures/sounds/fonts MB                                                                  | Google: every extra 6 MB costs about 1 % of installs, more in markets like ours; updates download it too                     |
| `screens.mjs` | Customer home, a menu, «طلباتي», a live order, and the restaurant board on a tablet: KB to open, then 30 s untouched: React redraws per minute, animation frames per second, KB per minute | An idle screen should be still. A redraw every second or a 60-frame loop is battery and heat for nothing (speed audit h1–h4) |

Redraws and frames are counted, not CPU %, so the numbers hold on shared CI machines. KB are the
uncompressed answers from the demo API (the real server squeezes them, d1).

## When a check fails

- Your change made a number bigger. Find out why (the table names the screen), and make it smaller.
- If the growth is worth it (a new screen, a new picture Ali asked for), raise `max` in `budgets.json` in
  the same PR and say why in the PR.
- When your change makes a number smaller, lower `max` to the new value plus a little headroom, so it
  cannot creep back. `target` is where the linked speed-audit idea takes it; it never fails.

## Run it locally

```sh
pnpm build
node scripts/perf/size.mjs                       # APPS=customer for one app
(cd apps/customer && EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:3200/trpc EXPO_PUBLIC_DEV_TOOLS=1 npx expo export --platform web --clear --output-dir dist-web)
(cd apps/merchant && EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:3302/trpc EXPO_PUBLIC_DEV_TOOLS=1 npx expo export --platform web --clear --output-dir dist-web)
node scripts/perf/screens.mjs                    # needs ports 3200 and 3302 free
```

`PLAYWRIGHT_MODULE` points at another Playwright if the Console's is not installed; `CHROMIUM_PATH` at a
browser. The full audit behind these numbers: `/mnt/project-files/perf-audit/audit.md` in the project files.
