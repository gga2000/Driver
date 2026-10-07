# الرجعة driver record, «ملفه» and riders' reviews

Ali, 2026-10-07 (Baghdad/Kut ideas x12–x17, all Yes): **riders see who they will travel 100 km with**:
his record on the board, the seat sheet and the ticket, a full profile, badges, and one-line reviews
that support can hide. Badge rules are the ones below until Ali changes them (asked on the thread).

## What riders see

| Where | What |
|---|---|
| Board tile | ★ rating · trips (or «سايق جديد»), the car on its own line, «سافرت وياه قبل» when the rider rode with him and he is not a favourite |
| Seat sheet and boarding pass («سايقك») | rating with its count, trips, on-time share; «الركاب يگولون: …» (the two tags riders tick most); badges; «ملفه» |
| «ملفه» (`/rajaa/driver/[departureId]`) | photo and first name, checked today, «ويا درايفر من …», rode before; the same strip; badges with how each is earned; a bar per quality; his car as painted for the seat picker, plate as it looks; the newest 20 lines riders wrote, month only, no names |
| After arriving («وصلت بالسلامة») | an optional line (140 characters) under the stars; phone numbers, links and @handles are refused in the field and on the server |

Numbers stay hidden until enough riders stand behind them: the rating after **3 ratings**, the on-time
share after **3 judged runs** («جديد» until then, never a dash).

## Rules (`RAJAA_REPUTATION_RULES`, `packages/contracts/src/routes-io.ts`)

- **Trips**: his finished runs (`arrived`, `closed`).
- **On time**: his garage check-in at most the late meter's grace (`lateMeter.graceMin`, 5 minutes) after
  the announced time, with the checkpoint waiver; runs without a check-in are not judged.
- **«سايق مميز»** (`top_driver`): 20+ ratings, average 4.8+, on time 9 in 10.
- **«العوائل ترتاحله»** (`family_trusted`): 8+ ratings from women or family riders, their average 4.8+, and
  none of them ticked «سياقة سريعة».
- **«ما يدخن»**, **«جناط كبيرة»**: the driver's own promise for the run (partner app › أعلن طلعة), stored
  in the departure's vehicle snapshot. Riders rate against it.

All of it is computed on the server (`apps/api/src/modules/routes/reputation.ts`, pure and unit-tested).

## API

- `routes.driverCards({ departureIds })` — each card now carries `stats`
  (`trips, ratingAvg, ratingCount, onTimeShare, topTags, badges, ridesWithYou`).
- `routes.driverProfile({ departureId })` → `{ card, vehicle, firstTripAt, qualities, reviews, reviewCount }`;
  same visibility as `driverCards` (a departure on the board or the rider's own booking), else
  `departure_not_found`.
- `routes.rate({ bookingId, stars, tags, comment? })` — `comment` trimmed, ≤ 140, refused with
  `review_contact_info` when it holds 7+ digits (Arabic-Indic too), a link or an @handle. Emits `seat.rated`.
- Support and admin (`REVIEW_MODERATION_ROLES`): `routes.ops.reviews({ hidden?, limit, cursor })` newest
  first (the writer's first name is read from the vault, purpose `review_moderation`);
  `routes.ops.hideReview({ bookingId, reason })` with reason `rude | personal_info | not_about_trip | untrue`
  and `routes.ops.unhideReview({ bookingId })`. Hiding keeps the text; both emit `review.hidden` /
  `review.unhidden`. Console page: «كلام الركاب» (`/reviews`).

## Storage

`seat_bookings.review_text`, `review_at`, `review_hidden_at`, `review_hidden_by`, `review_hidden_reason`
(migration `20261007230000_x14_driver_reviews`, index on `review_at`). The rating JSON stays
`{ stars, tags, at }`. Reviews hold no names; the profile shows the month in Baghdad time.

## Demo

Customer demo API: four drivers with real past runs (علي 24 runs and «سايق مميز», كرار the GMC with
families and «العوائل ترتاحله», مرتضى a mixed record, مصطفى «جديد»); `POST /demo/rajaa/rode?personId=…`
makes two of علي's past runs this person's. Shots: `SHOTS=driver node apps/customer/scripts/web-shots.mjs`.
Console demo API: five lines about two drivers in «كلام الركاب», one hidden.
