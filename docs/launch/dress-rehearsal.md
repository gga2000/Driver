# Dress rehearsal (G0-16) and first supply measurement (G0-17)

**When:** Wed 11 Nov 2026 (D-26), dinner time, 18:30–22:30. **Fallback:** Thu 12 Nov, same hours. A fix
found here must land before the build cut on Fri 13 Nov (D-24).
**Owner:** Ali, with field ops and every lane thread on call. Part of `can-deliver-plan.md`.

The goal: real people do real food orders end to end, on the builds we will test with, and we measure
how many orders each kitchen can actually make in an hour. We stop thinking and start counting.

## 1. Ready before the day (check on Mon 9 Nov)

| What | Who | Ready means |
|---|---|---|
| Builds | Lane C, lane D | EAS internal-distribution APKs of all three apps from the same commit, installed on every phone and tablet below; the Console on staging |
| Server | Lane B | Staging at launch sizes (W4), the real SMS gateway, push working (FCM), Sentry receiving |
| Kitchens | Field ops | The 4 launch kitchens, each with its tablet signed in, its real menu and prices entered and checked by a second person (plan §8.2) |
| Couriers | Field ops | At least 12 couriers briefed (`courier-briefing.md`), photos approved in the Console, partner app signed in, cash float for change |
| Customers | Ali | 15–20 staff, family and friends with the customer app, spread over at least 4 zones; each has 2 orders to place (section 3) |
| Console | Ali + support | 2 people signed in: one on dispatch and SOS, one on support chat; canned replies loaded |
| Money | Ali | Real cash at the doors. Rehearsal orders are real orders in the ledger and stay (append-only). Kitchens are paid as normal |
| Call list | Ali | A WhatsApp group with every courier, kitchen and thread owner, for anything the app can't carry |

## 2. Roles on the night

- **Ali**: runs the night, decides stop or go on any problem.
- **Dispatch desk** (Console): watches the live map and stuck orders; handles the SOS.
- **Support desk** (Console): answers chat; handles the dispute.
- **One observer per kitchen** (field ops or family): holds the throughput sheet (section 5) and
  writes down every problem with the time.
- **Thread owners on call**: lane A (orders, money), B (servers), C (apps), D (push, SMS, sign-in).

## 3. The script: at least 20 orders, with the hard ones on purpose

Normal orders: 14 or more, spread so each kitchen gets at least 3, mixing cash and wallet, near and far
zones, one with a note to the kitchen, one paid with a big note (change to the wallet), one order of
two dishes from the same kitchen placed together by two customers (two orders on one courier trip).

The planned hard cases, each with a named customer and courier:

| # | Case | How to make it happen | Pass |
|---|---|---|---|
| H1 | **Dispute** | After delivery, the customer says one dish was missing, through support chat | Support finds the order, decides with the toolkit (or as M-1 says by then), the customer sees the outcome in the app |
| H2 | **SOS** | A courier presses SOS on the way (told beforehand; nothing is wrong) | The dispatch desk sees it within 10 s, calls him back, closes it as "false alarm, test" with a note. The escalation reaches the second person (G0-9) if nobody acknowledges in 60 s |
| H3 | **Failed delivery** | A customer doesn't answer at the door | The courier follows the unreachable steps; the customer gets the push; the order ends as the rules say; nobody loses money they shouldn't |
| H4 | **Kitchen refuses** | One kitchen refuses an order it can't make | The customer is told within a minute and is not charged |
| H5 | **Dish unavailable** | One kitchen marks one dish as finished after accepting | The customer gets the choice in the app, the bill changes on the server |
| H6 | **Customer cancels late** | A customer cancels after the kitchen started cooking | The cancel fee shown matches the rule; the kitchen is paid as the rule says |
| H7 | **Courier phone dies** | A courier locks his phone for 10 minutes mid-delivery | His position keeps updating in the Console (G0-1) |
| H8 | **Busy now** | The observer tells one kitchen to stop taking orders | The kitchen shows «مشغول هسه» to customers, nothing is accepted then cancelled |

## 4. Cash at the end of the night

Each courier hands in the night's cash to field ops with his hand-over code. Pass: every courier's
cash in hand matches the Console to the 250, and each kitchen's statement matches its tablet.

## 5. Kitchen throughput sheet (G0-17)

Each observer fills one row per order: accepted at, ready at, picked up at. At the end:

| Kitchen | Orders | First accepted → last ready (min) | Orders per hour | Longest wait for a courier (min) |
|---|---|---|---|---|
| | | | | |

- **Orders per hour** per kitchen is the G0-17 number. Each kitchen's open-order cap = that number ×
  0.5, rounded down (plan §8.1). It goes in `gates.md` and in the controls.
- If one kitchen got too few orders to count, its cap stays at the planning number (8) until the
  closed-test peaks re-measure it (D-14).
- **Couriers needed at the dinner peak** = (sum of the kitchens' orders per hour ÷ 2.5) × 1.2. This
  starts the G0-18 roster.

## 6. Pass or repeat

**Pass** when all of these hold: 20 or more orders ended in the right state; H1, H2 and H3 handled end
to end; cash matches; every kitchen has a throughput number (or a written reason). Record it in
`gates.md` with the date, who checked, and the observers' sheets as evidence.

**Repeat** on Thu 12 Nov if any of H1–H3 failed or fewer than 15 orders ended right. Every problem
written down goes to its lane the same night, through the coordinator, marked "rehearsal, fix before
D-24".
