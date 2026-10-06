# Seasons, Ramadan mode and `system.season`

Customer joy J6 (`docs/superpowers/plans/2026-10-06-j6-seasons.md`), grown from the J1a quiet days
(`docs/api/quiet-days.md`, still valid). Periods live in `quiet_periods` with a `kind`. Days are Baghdad
calendar dates (`YYYY-MM-DD`, inclusive); a day turns at Baghdad midnight.

## Kinds

| Kind | Switches | Home card |
|---|---|---|
| `quiet` (mourning) | celebrations, sounds, offers and accent all off (forced) | none |
| `ramadan` | each on unless ops turn it off | the iftar countdown / suhoor line on the person's timetable (default words «رمضان كريم», or ops' line) |
| `eid` | each on unless ops turn it off | «عيدكم مبارك» (or ops' line); never names the day |
| `friday_special` | each on unless ops turn it off | only with ops' own line |

A quiet day wins every switch (and hides Eid and Friday cards) but **keeps the Ramadan times and the
Ramadan card**, calm (`accent: false`): iftar is service, not celebration (e.g. 19–21 Ramadan). Among the
others Eid > special Friday > Ramadan sets the switches; the home card prefers Ramadan's. Two periods of the
same non-quiet kind may not overlap in the same place (`season_overlap`). When the two communities start a
month a day apart, ops set the period over both days; copy never names a day.

Longest period: quiet 15 days, Ramadan 31, Eid 5, special Friday 1 (`SEASON_MAX_DAYS`).

## Procedures

| Procedure | Who | What |
|---|---|---|
| `system.season({ cityId?, timetable? })` | public | `{ quiet, celebrations, sounds, promos, quietUntil, kind, accent, ramadan, homeCard }`. `kind` is `ordinary` on a plain day. `ramadan` (every day of a Ramadan period) = `{ day, timetable, iftarAt, suhoorUntil, timetables: { sunni, shia } }`, each timetable `{ iftarAt, suhoorUntil, slotAt }`; the top-level `iftarAt/suhoorUntil` echo `timetable` when given, else null. Cached 5 s; apps poll every 5 min. |
| `system.seasons()` | dispatcher, support, finance, admin | The 60 most recent periods of every kind; Ramadan rows carry `days` (both timetables, HH:MM, `overridden`). |
| `system.setSeason({ cityId?, kind, startsOn, endsOn, label_ar, celebrations?, sounds?, promos?, accent?, homeCard?, homeCardAr?, shiaOffsetMin? })` | admin | `season_invalid` (past start, too long, a line on a quiet day, a Friday card without a line), `season_overlap`. Audited `season.set` (`quiet.set` for quiet). |
| `system.clearSeason({ seasonId })` | admin | Idempotent; `quiet_not_found` for an unknown id. Audited `season.clear` / `quiet.clear`. |
| `system.setIftarTime({ seasonId, day, timetable, time })` | admin | One day's iftar on one timetable set to the local mosque's time (`HH:MM`), or `null` back to the sun. `season_invalid` outside the period or on another kind. Audited `season.iftar`. |

`system.quietDays/setQuietDays/clearQuietDays` keep working and see only quiet periods.

## Iftar and suhoor times

`apps/api/src/modules/controls/prayer-times.ts`: the standard low-precision solar almanac (USNO /
praytimes.org formulas: mean anomaly, ecliptic longitude, obliquity → declination and equation of
time), hour angle at −0.833° for sunset and −18° for fajr, three passes at the event time. Aziziyah
32.91 N, 45.06 E, UTC+3. Iftar = sunset + the timetable's offset, **rounded up**; fajr **rounded down**.
Checked against the published Baghdad almanac (within a minute).

| Setting (`season.config.ts`, contracts) | Value | Status |
|---|---|---|
| Sunni maghrib | sunset + 0 min | verify locally |
| Shia maghrib (`DEFAULT_SHIA_MAGHRIB_OFFSET_MIN`) | sunset + 15 min; per period 0–40 | **verify locally** |
| Fajr angle (both) | 18° | **verify locally** (some Shia timetables use 16° and print an imsak) |
| Iftar slot | 10 min before the adhan | |
| Offer hold | 20 min before the earlier iftar until the later one | |

1 Ramadan 1448 (≈ 8 Feb 2027) in Aziziyah: Sunni iftar 5:39 م, Shia 5:54 م, suhoor until 5:26 ص.
Last day (≈ 9 Mar): Sunni iftar 6:03 م.

## Offers (notify)

Every `marketing` delivery asks `ControlsService.promoHold(at)`, at dispatch and again at send:
`quiet_day` and `season` (a season with offers off) suppress it; `iftar` defers it to the later
timetable's iftar (`status: deferred, reason: iftar`), then it goes. Transactional messages are unchanged.

## Slot caps

`apps/api/src/modules/orders/slot-cap.ts` (`SLOT_CAP_RULES`): a per-kitchen cap on scheduled orders per
slot (±15 min), **off by default**; `orders.place` answers `slot_full` past it. The Merchant app has no
capacity setting yet; ops switch a cap on in config.

## Customer app

The person picks a timetable once (home card or profile › notifications › «توقيت رمضان»), stored on the
phone (`driver.customer.ramadan_timetable`); nothing is assumed before. Checkout offers «على الفطور ·
{adhan}» (the server's `slotAt`) while it is at least 45 min away. Demo: `POST /demo/season?kind=ramadan|eid|off`
(customer demo API).
