# SOS (`safety.*`)

Date: 2026-10-05. Scoring & safety spec §3; the UI/UX audit made it a launch requirement (P-02).
Contracts: `packages/contracts/src/safety-io.ts`, `routers/safety.ts`; API: `apps/api/src/modules/safety`;
UI: `SosButton` / `SosSheet` in `packages/ui`, `features/safety` in Partner and Customer, the
Console banner (`components/safety/banner.tsx`) and desk (`/safety`).

## What happens

```
hold "طوارئ" 3 s ─► safety.sos ─► safety_incidents row + sos.raised (outbox) ─► view to the phone
                                   │
                                   ├─ subscriber safety:alerts ─► notify: every live dispatcher + admin
                                   │                              (push + WhatsApp, SMS twin after 30 s)
                                   ├─ live channel `safety` ─► Console red banner + alarm on every page
                                   ├─ +10 s (cancel window over) ─► emergency contact: WhatsApp with the
                                   │                              live-location link (SMS twin after 30 s)
                                   └─ +60 s nobody took it ─► sos.escalated ─► admins paged again
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

## Demo

- Partner: hold طوارئ on any job, departure, private ride or خطوط run (`SHOTS=sos` shoots it).
- Customer: a ride with a driver, or `POST /demo/rajaa/onboard?personId=…` for a seat checked in at the garage.
- Console: `POST /demo/sos[?who=driver|customer]` on the console demo API (or `DEMO_SOS=1`).

## Not done yet

- "Escalates to Ali by call": the escalation pages admins by push, WhatsApp and SMS; an automatic
  phone call needs the telephony provider.
- "On shift" means every live dispatcher and admin role until a staff rota exists.
- Audio recording on the pressing phone (spec §3) is not built.
- Drivers set their emergency contact in the Partner app (الحساب → رقم للطوارئ, 2026-10-05) through
  the same `identity.updateProfile`; the contact now also keeps `relation` (`mother`, `father`, `spouse`,
  `sibling`, `child`, `relative`, `friend`, `other`) in the vault. A driver's SOS messages his own contact.
