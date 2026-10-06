# Quiet days and `system.season`

Mourning days ops set in the Console (customer joy J1a). Days are Baghdad calendar dates
(`YYYY-MM-DD`, inclusive); a day turns at Baghdad midnight.

| Procedure | Who | What |
|---|---|---|
| `system.season({ cityId? })` | public | `{ quiet, celebrations, sounds, promos, quietUntil }` for today. Cached 5 s per API instance. Apps poll every 5 min. |
| `system.quietDays()` | dispatcher, support, finance, admin | The 30 most recent periods with `active`. |
| `system.setQuietDays({ cityId?, startsOn, endsOn, label_ar })` | admin | Starts today or later, at most 15 days. `quiet_invalid` otherwise. Audited (`quiet.set`). |
| `system.clearQuietDays({ quietId })` | admin | Idempotent. `quiet_not_found` for an unknown id. Audited (`quiet.clear`). |

Effects on a quiet day: the customer app plays no delivered burst, no success buzz and no moment sounds;
the notify engine suppresses every `marketing` delivery (`reason: quiet_day`), including offers deferred
from the night before. Transactional messages are unchanged.

Since J6 these periods are one kind of season (`kind: quiet`); see `docs/api/seasons.md` for Ramadan,
Eid, special Fridays and the new `system.season` fields.
