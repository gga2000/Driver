# Shift handover note (Console › اليوم, h5)

The outgoing shift writes a few lines for the next one ("مطعم خالد طابعته عاطلة، اتصلوا بيه قبل
المغرب"). The next shift sees the newest note at the top of Today until each person taps «وصلت»,
or until it is 16 hours old. Every staff desk (admin, dispatcher, support, finance, field ops) may
read, write and acknowledge.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `onCall.handover` | query | `{ cityId }` | the newest note from the last 16 h, or null |
| `onCall.handoverWrite` | mutation | `{ cityId, body }` (1–1,000 characters) | the note |
| `onCall.handoverAck` | mutation | `{ id }` | the note |

A note answers `{ id, cityId, authorId, body, createdAt, ackedByMe, acks, mine }`. The writer's own
note counts as read by them. A second «وصلت» changes nothing.

Writing is audited (`handover.written`, subject `handover_note`). A tap is a read receipt: the
`handover_acks` row is the record, so it is not written to the audit log.

## Where

`handover_notes` and `handover_acks` (migration `20261010510000_handover_notes`): staff ids, times
and the staff-written note. `HandoverService` lives in `apps/api/src/modules/on-call/handover.service.ts`.
The author's name is read through the Console's names lookup, like every other staff name.
