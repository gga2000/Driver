# SOS (`safety.*`)

Date: 2026-10-05. Scoring & safety spec §3; the UI/UX audit made it a launch requirement (P-02).
Contracts: `packages/contracts/src/safety-io.ts`, `routers/safety.ts`; API: `apps/api/src/modules/safety`;
UI: `SosButton` / `SosSheet` in `packages/ui`, `features/safety` in Partner and Customer, the
Console banner (`components/safety/banner.tsx`) and desk (`/safety`).

## What happens

```
hold "طوارئ" 3 s ─► safety.sos ─► safety_incidents row + sos.raised (outbox) ─► view to the phone
                                   │
                                   ├─ subscriber safety:alerts ─► the on-call rota's first page (ON_CALL_PORT,
                                   │                              2 s limit) ─► notify (push + WhatsApp, SMS twin
                                   │                              after 30 s); rota absent/slow/empty/failing ─►
                                   │                              every live dispatcher + admin (logged
                                   │                              `safety_oncall_fallback`), the SOS is never refused
                                   ├─ subscriber on-call:ladder ─► rings again every 30 s, on-call people at 60 s,
                                   │                              the next ones at 120 s (docs: on-call module)
                                   ├─ live channel `safety` ─► Console red banner + alarm on every page
                                   ├─ +10 s (cancel window over) ─► emergency contact: WhatsApp with the
                                   │                              live-location link (SMS twin after 30 s)
                                   └─ +60 s nobody took it ─► sos.escalated ─► admins paged again only when the
                                                                  first page was the fallback (the rota's ladder
                                                                  escalates otherwise)
phone, every 5 s while open ─► safety.position (trail; throttled at 30 a minute)
```

The emergency contact is a number, not an account: notify sends to the recipient `ec:<personId>`
and reads the number from the vault (logged, accessor `system:notify`). The link opens
`/sos/<token>` in the customer web app (public; HMAC-signed, first name and last fix only; dies 30
minutes after the alert closes). A phone without GPS still raises the alert; the API then starts
from where the car last was when the person is in it.

## Procedures

| Procedure | Who | Notes |
|---|---|---|
| `safety.sos` | any session | `{subject: {kind: trip\|order\|departure\|booking\|request, id}, position, category?, pressedAt?, clientId}`. The caller must be a party of a trip that is going or ended < 30 min ago (`sos_not_party`, `sos_trip_over`). Same `clientId` → same incident; a second hold while one is open joins it. 5 new incidents per person per hour (`sos_rate_limited`). |
| `safety.cancel` | the person | Inside 10 s only (`sos_cancel_window_passed`). Logged as a false alarm, never erased; the contact is not messaged. |
| `safety.status` | the person | By id, or the person's open incident (the screen restores the lit button). |
| `safety.position` | the person | One fix; ignored once the incident is closed. |
| `safety.category` | the person | Optional, after the alert (accident, harassment, threat, medical, other). |
| `safety.shared` | public | The contact's page. |
| `safety.list` / `get` | dispatcher, support, admin | Names and masked numbers are vault reads logged against each person with the staff member as reader. |
| `safety.acknowledge` / `note` / `resolve` | dispatcher, support, admin | Resolve needs an outcome (safe, false alarm, police/ambulance, escalated) and a note ≥ 5 characters. Audited. |
| `safety.requestCall` | dispatcher, support, admin | Masked call to the person, the other party or the emergency contact (chat's bridge: the real number in development, the proxy number otherwise). |
| `live.safety` | dispatcher, support, admin | SSE: `invalidate ['safety.open']` on every change. The Console also polls every 5 s. |

Tables: `safety_incidents`, `safety_incident_entries` (timeline), `safety_incident_fixes` (trail);
migration `20261005140000_safety_incidents`. Env: `SAFETY_LINK_BASE_URL`, `SAFETY_LINK_SECRET`,
`CONSOLE_BASE_URL`, `SAFETY_SWEEP_MS` (default 5,000), `SAFETY_TIMERS=0`.

## Emergency number (Ali, 2026-10-06)

The SOS sheet's call button and the "if the danger is close" fallbacks dial **911**, Iraq's unified
national emergency number (Ministry of Interior; police, ambulance and fire, Wasit included), not
104: «اتصل بالطوارئ 911». One constant, `SAFETY_RULES.policeNumber` in `safety-io.ts`, passed by the
Customer (rides and the emergency contact's `/sos/<token>` page) and the Partner app to `SosSheet`;
the server's `sos_not_party` / `sos_trip_over` messages say the same number.

## خطوط: the car nobody checked (2026-10-06)

Not an SOS, but it reaches the same people: when a خطوط run ends and the driver has not confirmed
the car is empty within `KHAT_RULES.sweepAlertAfterMin` (5) minutes, a red row appears under the
SOS banner on every Console page for dispatchers, support and admins (`SweepAlertStrip`,
`components/safety/sweep-strip.tsx`): the driver, the run, where and when the last child got out,
how long ago, and "اتصل ب…" through the masked line (`khat.callSweepDriver`). The driver gets a
push reminder at the same moment, and every live dispatcher and admin is paged on the phone the way
SOS pages them (same roster, `SAFETY_PAGED_ROLES`; push + WhatsApp, template
`khat_sweep_dispatch_alert`: «خط #4821: ما تأكد إن السيارة فاضية من 5 دقايق», no children's names),
once per alert and not at all if the driver confirmed in time. His late confirm turns the row calm
("تأكد متأخر {n} دقيقة") and it leaves after 30 minutes. A dispatcher can also close an open row
(«سكّر التنبيه», `khat.closeSweepAlert`) with a reason — «اتصلت بالسايق، السيارة فاضية», «اتصلت
بالأهل» or «غيرها» with a short note — audited (`khat.sweep_close`); the row leaves the strip and the
record keeps who, when and why. A later driver confirm is still recorded. Procedures, timer and table: `docs/api/partner-merchant-wave2.md`
(`khat.sweepAlerts`, "The late sweep").

## الرجعة: a seat PIN on the wrong seat (2026-10-06)

The same strip carries الرجعة seat-PIN rows (`PinAlertRow`): a driver typed one rider's PIN on
another rider's seat (red, refused, nobody boarded), or typed a wrong PIN 3 times on one seat
(amber). Each row names the driver, the car and when it leaves, unfolds every PIN typed on that car
(times, seats, what happened; never the PIN) and calls the driver through the masked line
(`routes.ops.callPinAlertDriver`). It leaves after 60 minutes. Details: `docs/api/partner-merchant-wave2.md`
("Seat PIN safeguards").

## Demo

- Partner: hold طوارئ on any job, departure, private ride or خطوط run (`SHOTS=sos` shoots it).
- Customer: a ride with a driver, or `POST /demo/rajaa/onboard?personId=…` for a seat checked in at the garage.
- Console: `POST /demo/sos[?who=driver|customer]` on the console demo API (or `DEMO_SOS=1`);
  `POST /demo/khat-sweep[?late=1]` for the خطوط sweep row; `POST /demo/pin-alert[?kind=wrong]` for a
  الرجعة seat-PIN row.

## Not done yet

- "Escalates to Ali by call": the escalation pages admins by push, WhatsApp and SMS; an automatic
  phone call needs the telephony provider.
- "On shift": the rota rings the whole desk first (every live dispatcher, support agent and admin),
  then the people on call. `sos.raised` carries `subjectLabel` (kind + ticket, e.g. «طلب أكل #123»;
  a private ride is only «مشوار خاص») so the ladder's later pages can say what it is about.
- Audio recording on the pressing phone (spec §3) is not built.
- Drivers set their emergency contact in the Partner app (الحساب → رقم للطوارئ, 2026-10-05) through
  the same `identity.updateProfile`; the contact now also keeps `relation` (`mother`, `father`, `spouse`,
  `sibling`, `child`, `relative`, `friend`, `other`) in the vault. A driver's SOS messages his own contact.
