# The Console watching itself

Console build plan E1 step 3 (Ali, 2026-10-08). Owner: lane E. Code: `apps/api/src/modules/on-call`
(`console-watch.service.ts`, `console-watch.repository.ts`), rules in `CONSOLE_WATCH_RULES`
(`packages/contracts/src/on-call-io.ts`), Console strip in `apps/console/src/components/shell/watch-strip.tsx`.

## `onCall.present` (mutation, every staff role)

Every open Console tab calls it at once, whenever its live-updates state changes, and every 30 s.

Input: `{ cityId, tabId, live }`
- `tabId`: random per tab, kept in `sessionStorage`.
- `live`: `live | connecting | fallback | stopped` (`stopped` = the page uses no live updates).

Output: `{ cityId, open: ConsoleWatchAlert[] }`, the city's open watch alerts. The strip reads
`live_down` from it. It is a heartbeat, not an action, so there is no audit row (staff-audit GAPS).

## The two alerts

The on-call sweep (job machines only, every 5 s) checks each city in `CONSOLE_WATCH_CITIES`
(default `aziziyah`):

| Kind | Opens when | Closes when |
|---|---|---|
| `unwatched` | During working hours, no tab has sent a heartbeat for 5 minutes. Working hours are 06:00–02:00 city time, plus any hour while someone is on call on the SOS desk. The gap is counted from the later of the last heartbeat and the start of the hours, so if nobody opens the Console in the morning the page comes at 06:05. | A tab sends a heartbeat, or the hours end. |
| `live_down` | Every tab that uses live updates (any state except `stopped`) has had them down (`fallback` or `connecting`) for 1 minute. | Any of them is live again, or no tab uses live updates. |

Each alert opens once. `console_watch_alerts.open_key` (`<city>:<kind>`, unique, null once closed)
is the claim, so two job machines never page twice. On opening, the people on call on the SOS desk
(rank 1 and 2) are told. When nobody is on call, the admins are told. Templates:

- `console_unwatched_alert`
- `console_live_down_alert`

Both are safety category, push and WhatsApp, with an SMS twin after 60 s. They take the params
`minutes` and `link`. A new gap opens a new alert and pages again.

In the Console, a red strip shows under the other strips:
- after this tab's own live updates have been down for 1 minute: «الشاشة تتحدث كل كم ثانية بس»;
- when the server's `live_down` alert is open: «والمناوب انبلغ».

The strip publishes `--watch-h` so full-height pages shrink by it.

## Tables

Migration `20261010150000_console_watch`. Both tables hold ids and times only.

- `console_presence`: one row per (city, tab) with `live`, `live_since` and `last_seen_at`. Rows
  older than 24 h are dropped hourly.
- `console_watch_alerts`

## Before launch

The two WhatsApp templates need Meta approval, along with the others.
