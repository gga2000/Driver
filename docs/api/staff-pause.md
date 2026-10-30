# Staff pause (r6)

Ali, 2026-10-08: staff can pause a courier or driver straight from a safety report while they look
into it.

- `driverAccount.pause({ personId, reason: 'safety_report' | 'other', ticketId?, note })` — admin,
  dispatcher, support, field ops. The person must hold a driving role; nobody pauses himself. A note
  (3–300 characters) is required. Pausing someone already paused returns the open pause unchanged. A partial unique index keeps at most one open pause per person, so two staff pausing at the same moment end with one pause (the second gets the first's), and one lift clears it.
- `driverAccount.liftPause({ personId, note })` — same roles; `invalid_input` when he isn't paused.
- `driverAccount.pauseStatus({ personId })` — the open pause (when, by whom, why) or `active: null`.

While paused, the online gate (`driverAccount.onlineGate`, `partner.goOnline`) answers
`staff_paused` first and `partner.goOnline` refuses with `driver_paused`; the app's 30-second
heartbeat drops him offline. A job he is already on carries on. No money changes.

Both steps write a Console audit row (`driver.pause` / `driver.lift_pause`, note length only) and an
event (`driver.paused` / `driver.unpaused`). Table `driver_pauses` (migration 20261010470000), one
open row (`lifted_at` null) per person.

Console: the panel sits on the safety report (with its ticket, when the report's order has a
courier) and at the top of the driver's book (`/drivers/<id>/ledger`).
