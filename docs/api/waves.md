# Customer waves and the waitlist (W5, decision D-24)

More people would order on day one than the kitchens can cook (about 1,500 a day against about 400; plan
§D-24). Food orders open **area by area, in waves**. Sign-up stays open and anyone can browse menus. A
customer whose area has no free place waits («نبلّغك من يصير دورك») and gets one message when their
turn comes.

**Off by default.** A zone with no wave is open to everyone, and no zone has one until ops sets a number.
Merging this changes nothing for anyone. No money rules are involved.

## Rules

- **Your area** is the zone of your own first saved place: home, then work, then the oldest. With
  waves on and no saved place yet, the answer is `needs_place`: saving a place puts you in line, and
  you keep the date you joined.
- **Never wait:** staff, partners and merchants (any role besides customer), and anyone who placed an
  order before (`reason: staff | existing`).
- **Let in** while `let in in the zone + people waiting before you < open places`. A newcomer never
  jumps the line while others wait. Once let in, it is for good: lowering the number puts nobody back.
- **Only food and shop orders wait.** `orders.place` refuses them with `waitlisted` («لسه ما وصل دور
  منطقتك. نبلّغك أول ما يصير دورك»). Rides, الرجعة and browsing are not affected.
- **The sweep** runs every minute (`WAVE_RULES.sweepEveryMs`). It lets the longest-waiting in, oldest
  first, at most 200 per zone per pass. Each person let in gets `access.opened` once, keyed
  `access.opened:<person>`. Notify sends it as `access_open`:
  - a push («صار دورك»);
  - an SMS 60 s later if the push isn't confirmed (a new phone often has no push yet);
  - held out of quiet hours (23:00–08:00).
- **Turning waves off:** `openSlots: null` on a zone lets everyone waiting there in. When no zone of the
  city has a wave, people without a place are let in too.

## Procedures

- `access.status()` (signed in) → `AccessView`:
  - `state`: `open`, `waiting` or `needs_place`;
  - `zoneKey` and `zoneNameAr` (Western digits);
  - `ahead`: how many waiting people in the zone joined earlier;
  - `waitingSince`.
  The first call decides the person's place in line.
- `ops.waves.view({ cityId })` (Console read roles) → every zone with `openSlots`, `admitted` and
  `waiting`, plus `waitingWithoutZone`.
- `ops.waves.setSlots({ cityId, zoneKey, openSlots })` (admin / dispatcher, like the zone throttle):
  - sets `0`–`100000`, or `null` for no wave;
  - an unknown zone gives `control_invalid`;
  - it is audited (`wave.set`, «دور زاكور: 450 زبون») with event `ops.zone_wave_set`;
  - it lets in whoever the new number has room for right away.

## Races

A person's decision holds `access.person:<id>`, then `access.zone:<city>:<zone>`. The sweep and
`setSlots` hold only the zone lock. Both are an in-process lock plus a Postgres advisory transaction lock.
`access.integration.test.ts` checks two instances: eight people deciding at once for three places, and
two sweeps at once after a raise. Without the zone lock the test fails.

## Storage

Migration `20261010440000_customer_waves`. Ids and zone keys only; no personal data.

- `customer_access`: one row per person; `state waiting | admitted`, `reason`, `joined_at`, `admitted_at`.
- `ops_zone_waves`: one row per city and zone; `open_slots` (null = open).

## App

- Home shows `WaitlistCard` («لسه ما وصل دور منطقتك») under the services while you wait.
- `app/waitlist.tsx` explains why, shows your area, how many are ahead, that a message will come, and that
  menus are open meanwhile. It has a needs-place state and an «صار دورك» state.
- The route guard sends a waiting person from checkout to `/waitlist`, including when they come back
  there after signing in.
- A toast says «صار دورك، هسة تگدر تطلب» when the app sees you let in while open.
- Saving a place refreshes your place in line.

## Not yet

- **Console page:** lane E (Console › الإطلاق) builds it on `ops.waves.*`.
- **The store reviewer account:** it should never wait. The store-review branch adds that check when it
  lands (today it holds only the customer role, so it would wait like anyone).
- **A household:** a member waits on their own, even when the payer is already let in.
