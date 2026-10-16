# Screen switches (W6, REL-16)

The after-order redesign (basket, checkout, following the order, «طلباتي») ships beside today's
screens. Each new screen shows only while its switch is on, so ops can show it to staff first, then to
every customer, and send everyone back to the old screen on a bad night without an app update.

| Switch | Screen | Arabic name (Console, audit log) |
|---|---|---|
| `basket_v2` | the basket | السلة |
| `checkout_v2` | checkout | الدفع |
| `track_v2` | following a food order | متابعة الطلب |
| `orders_v2` | «طلباتي» and receipts | طلباتي |

Each switch is in one of three states: `off` (nobody, the default), `staff` (anyone holding a
Console role: dispatcher, support, finance, admin) or `all` (every customer). One city at a time.

## Reading them in an app: `system.screens`

```ts
const shown = await api.system.screens.query({ cityId: 'aziziyah' });
// { basket_v2: false, checkout_v2: false, track_v2: true, orders_v2: false }
```

- Public: signed out sees only screens that are on for everyone; signed in, the server checks the
  caller's roles only when some screen is on for staff.
- Read it once when the app starts (and after sign-in), then keep the answer until the next cold start.
  **Never flip a screen under an open flow**: a customer half-way through checkout stays on the screen
  they started on.
- Anything unread (offline, an error, an old server without the procedure) means **the old screen**.
  An answer saved from the previous start may stand in; with none, never default to on.
- `EXPO_PUBLIC_UI_SWITCHES` (the build-time list in `apps/customer/src/lib/ui-switches.ts`) stays for
  the studio and screenshots. In a store build the server's answer decides.
- Changes reach the server within about 2 seconds; apps pick them up at their next start.

## Changing them: Console → التحكم

- `ops.controls.screens({ cityId })` lists the four switches with who changed each last and why
  (Console read roles).
- `ops.controls.setScreen({ cityId, key, audience, reason })`:
  - showing a screen (`staff` or `all`) is an **admin's** call;
  - any dispatcher on shift may switch a screen **off** (the "go back" button for a bad night).
- Every change writes an `ops.screen_switch_set` event and an audit row (`subjectKind: 'screen'`,
  action `screen.set`), e.g. «الشاشة الجديدة «السلة» صارت للموظفين بس: نجرّبها بموبايلاتنا».

## Storage

No new table: each switch is two rows in `ops_kill_switches` with scope `screen`, keyed
`ui.<name>@staff` and `ui.<name>@all` (`active` = shown to that audience; `all` implies `staff`). Screen
rows never stop an order, never hold dispatch and never show on the kill-switch board.

## The plan

Built for the plan's D-24 (screen switches by 13 Nov). The new screens switch on for staff first, then
for customers around D+30 (Ali, 2026-10-07: "staff first").
