# Customer app joy audit (2026-10-05)

The second UI/UX audit of `apps/customer`. The first one (`../customer.md`, 2026-10-04) found what was
broken; most of its P0/P1 items have been built since. This one asks how to get from "correct" to
"loved": appetite, personality, motion, sound, habit, family and Iraqi seasons. Audit only: no
product code was changed.

**Decision board for Ali:** https://claude.ai/artifact/TDLpwrrQfVf9gY8Qhamktc
It holds scores, the roast, six before/after concept screens, the three brand directions, 12 big
decisions and 107 ideas to vote on. Votes are stored in the artifact's database: collection `votes`
(doc id = idea id such as `f1`, `b2`; fields `v` = yes | maybe | no | null, `note`) and collection
`choices` (doc id = decision id such as `look`, `smallorder`; field `option`).

## Reports

| File | Slice | Joy now → target | Findings |
|---|---|---|---|
| [1-discovery.md](1-discovery.md) | Welcome, sign-in, home, search, restaurant list | 5 → 8.5 | D-01…D-27 (6 P1) |
| [2-food-funnel.md](2-food-funnel.md) | Restaurant, item sheet, cart, checkout, kitchen wait, reorder | 5 → 9 | F-01…F-33 (7 P1) |
| [3-live-moments.md](3-live-moments.md) | Tracking, arrival, rating, chat, share, SOS, taxi/tuktuk | 5.5 → 8.5 | L-01…L-29 (9 P1) |
| [4-rajaa-wallet-account.md](4-rajaa-wallet-account.md) | الرجعة, طلباتي, wallet, account, household, safety | 5.6 → 8.5 | R-, W-, A- (9 P1) |
| [5-design-system.md](5-design-system.md) | Colour, type, icons, illustration, motion, sound, dark mode | 5 → 8.5 | S2-01…S2-23 (10 P1) |
| [6-delight-strategy.md](6-delight-strategy.md) | Habit loops, 50-idea bank, seasons, anti-ideas, ~200 sources | — | Ideas A1…H3 |

`img/brand2-directions.png` is the side-by-side mock of the three brand directions. The reports
mention other screenshots under `scratchpad/audit/…`; those lived in the audit session's scratchpad
and are not kept. The screens can be recaptured with `apps/customer/scripts/web-shots.mjs`.

## Verdict

The foundations are rare in Iraq: honest delay credits, the per-person cart, the الرجعة seat rule
and pass, total-in-the-button pricing, the cash hand-off, tested contrast and a real Iraqi voice.
What's missing is a soul. The screens show no food (letters and one repeated kebab drawing), the app
has no sense of time, one orange carries seven meanings, the peaks are silent (rides) or interrupted
(the notification question over the map), and the الرجعة trip has no ending. "The words are from
Aziziyah; the pixels are from anywhere."

## Recommendations in one screen

- **Look:** direction A "Istikan" (`5-design-system.md` §5): orange becomes tea (main action and
  food only), kashi turquoise = live and moving, ink = selected, saffron = deals, points and stars;
  Alexandria + Marhey + IBM Plex; an Aziziyah illustration set plus a menu photo day; a night theme;
  "pour and settle" motion; a recorded tea-glass clink as the sound logo.
- **Strategy:** useful town + generosity first (today's pot, the next car, usuals, sending meals to
  family), with certain, never-chance rewards underneath (`6-delight-strategy.md` §0–1).
- **Phases:** 0 fix first (1–2 weeks) → 1 new look → 2 signature moments → 3 habit and family → 4 later.

## Dates

- **~13 Nov 2026:** next mourning day. The delivered burst and sounds shipped on 2026-10-05 play every
  day; a quiet-mode switch should be live before then (board idea `f8`).
- **Mid-Jan 2027:** Ramadan starts around 8 Feb; the season system and Ramadan mode (`s1`, `s2`).
- **Before the first Play Store upload:** the customer app ID. `CLAUDE.md` says `iq.driver.app`
  (confirmed), but `apps/customer/app.json` and `docs/deploy/mobile.md` use `iq.driver.customer`.

## Decisions that need Ali (money or product rules)

Small orders below a minimum (fee vs fill-the-gap), when a ride search gives up and whether it
re-quotes, which bill part points pay first (the server says service fee, the app text says
delivery), tiers, the referral copy (an unused string says 2,000 points; the rule is 200), whether
"أني نازل" pauses the unreachable clock, minute plurals (reverses voice spec §5), stamp cards, rolling
points expiry, Eidiya (also legal), charity and Arbaeen commission waivers, the courier heat
allowance. Full list: `6-delight-strategy.md` Appendix A and `3-live-moments.md` appendix.
