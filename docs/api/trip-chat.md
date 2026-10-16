# Baghdad/Kut chat (`chat.trip.*`, `live.tripChat`)

Private car round 2 step 4c: Ali's item 11 (chat moves to the trips thread, "2. yes" 2026-10-08 22:36Z)
and design way 2 with rules a1–a9 (round-2 agreed-prices page). A rider and the driver of a seat run, or
of a private-car offer, talk in one thread per pair. The prices they agree (step 4, `routes.agreements.*`;
step 4b, the private car's «احجز وادفع كاش») show in it as cards, with a pinned «اللي اتفقنا عليه» strip.
Chat only shows them: the agreement or offer stays the record and the rules stay in
`docs/api/agreed-trip-prices.md`.

Server: `apps/api/src/modules/chat/trip-chat.service.ts` (messages, cards, push) and
`apps/api/src/modules/routes/trip-chat.subjects.ts` (who the two are, open or closed, the live prices).
Migration `20261010400000_trip_chat`: `chat_threads.party_id` (the unique key becomes
`(order_id, kind, party_id)`; order threads keep `''`) and `chat_messages.ref_kind / ref_id /
ref_amount_iqd` for cards. No new table.

## A thread

Kind `rider_driver` (roles `customer` = the rider, `courier` = the driver; `ride: true`). Stored in the
chat tables with `order_id` = the run (`dep_…`) or request (`rq_…`) and `party_id` = the side it is keyed
by: the **rider** on a run (one driver, many riders), the **driver** on a request (one rider, many drivers).

A caller names a thread by `subject` (`departure` | `request`), `id` and, when he is not that side, `with`:

| caller | names it by |
|---|---|
| rider of a run | `{ subject: 'departure', id }` |
| driver of a run | `{ subject: 'departure', id, with: riderId }` |
| rider of a request | `{ subject: 'request', id, with: driverId }` |
| driver of a request | `{ subject: 'request', id }` |

## Who may talk, and until when

- **A run:** a rider may start while the run takes bookings (`scheduled`, `boarding`). The driver may
  open a thread only with a rider who booked, asked for a price, or already wrote. Once the car leaves,
  a rider without a seat keeps reading only if he wrote before, and his thread closes 30 minutes after
  the car left; a rider in the car talks until 30 minutes after it arrives (or the run closes or is
  cancelled).
- **A private-car request:** the rider and each driver who offered, while that offer is open. Once the
  rider picks, only the picked driver; the others close. The picked pair talks until 30 minutes after the
  ride closes.
- Anyone else: `chat_not_party`. A closed thread reads but refuses messages (`chat_closed`).
- No masked calls here (`canCall: false`): garage mode keeps its «اتصل».
- Spam guard: one person starts at most 20 new threads a day (`TRIP_CHAT_OPENS_PER_DAY`); messages share
  the order chat's per-minute budget. Phone numbers in text are masked as in every chat.
- Text, quick replies (rider: «وين أنتظرك بالضبط؟», «عندي جنطة كبيرة، تتسع؟», «جاي، دقايق وأوصل»;
  driver: «نطلع بالوقت إن شاء الله», «وصلت للكراج، أنتظرك», «تتسع، جيبها»), photo, location and voice
  notes (deleted when the thread closes, like the ride chats).

## Cards

Outbox subscriber `chat:trip_cards` turns three routes events into a `card` message in the pair's thread
(written once per event; it opens the thread if nobody wrote yet, and pushes the other side):

| event | card | from |
|---|---|---|
| `agreement.asked` | an ask (pin on the road / door drop), no amount | the rider |
| `agreement.proposed` | the driver's price (0 = «ببلاش») | the driver |
| `request.cash_asked` | «يحجز ويدفع كاش» with the no-show amount | the rider |

A card's `state` is read live from routes when the thread is read: `asked`, `proposed`, `accepted`,
`declined`, `expired`, `withdrawn`, `used` (locked on the booking). An older card about the same thing
and stage, or a price card whose amount has since changed, reads `replaced`. Pin cards carry how far
the pin is from the garage (`distanceKm`), the driver's reason for a price.

Answering stays with the routes procedures: the rider's «موافق / لا» calls `routes.agreements.respond`;
the driver prices an ask with `routes.agreements.propose` (from the card or «اقترح سعر» in the composer);
the driver answers a cash ask with `routes.requestBoard.answerCash`.

## The strip (`deal`)

Every live price between the two, one line per kind (newest): `asked` (waiting for the driver),
`proposed` (waiting for the rider), `agreed` (`locked` once on the booking). A cash line shows the
no-show amount. `chat.trip.threads` counts `waitingOnYou` from it.

## Procedures

| procedure | who | does |
|---|---|---|
| `chat.trip.thread` | either side | the thread: messages with cards, `deal`, `trip` (cities, time, booked), `partyId` |
| `chat.trip.threads` | either side | his threads on one run or request: the other side's first name (vault read, purpose `trip_chat`), unread, `waitingOnYou` |
| `chat.trip.send` | either side | one of text, quick reply, photo, location, voice note |
| `chat.trip.voiceUpload` | either side | a voice-note upload ticket |
| `chat.trip.markRead` | either side | read up to a seq |
| `live.tripChat` | either side | pushes each new message (channel `tripchat:<id>:<partyId>`); the recipient's driver channel re-reads `chat.trip.threads` |

Pushes (`chat.message_sent`) open the right app: the rider's `driver://rajaa/chat/<subject>/<id>`
(`?with=<driverId>` on a request), the driver's `driver-partner://intercity/chat/<subject>/<id>`
(`?with=<riderId>` on a run). A card pushes «عنده طلب يحتاج ردك» (an ask or a price).

## Apps

- Customer: `/rajaa/chat/[subject]/[id]`; «اسأل السايق» on a run's screen, «اسأله» on each private-car
  offer and on the picked car.
- Partner: `/intercity/chat/[subject]/[id]`; «رسائل الركاب» on his run, a chat button on each rider row,
  «راسله» on his private-car offer and ride.

Not in 4c: the Console view of a booking's agreements (a9, lane E), calls inside trip chat.
