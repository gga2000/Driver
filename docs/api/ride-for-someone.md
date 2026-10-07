# «لمنو المشوار؟» — a ride booked for someone else (ride ideas c9 + s3, 2026-10-07)

c9: he books a taxi or تكتك for his mother — her name and number — the driver calls her and she gets the
trip link. s3: he sees her ride live on his own phone until she arrives. He pays as on any ride; the
fare, the money rules and the ledger don't change (the rider is not a payer).

## Input (`orders.place`, rides only)

`PlaceOrderInput.rider` (`RideRiderInput`, `packages/contracts/src/order.ts`) — left out means «إلي»:

| `from` | Fields | Who it is |
|---|---|---|
| `typed` | `name` (1–40, `RIDE_RIDER_NAME_MAX`), `phone` (Iraqi mobile, normalised) | anyone he types |
| `trusted` | `index` | one of his trusted contacts (the safety list, `docs/api/safety.md`) |
| `household` | `householdId`, `personId` | a member of his household (not himself) |
| `recent` | `orderId` | the rider of one of **his own** earlier rides — so the app never keeps anyone's number |

Errors: `ride_rider_is_you` (the number is his own — pick «إلي»), `ride_rider_unknown` (the trusted index,
household member or earlier ride doesn't exist, isn't his, or had no rider), `invalid_input` (a rider on
a food order, or a rider participant / `ref: 'rider'` sent by hand). The same client request id returns
the same order (idempotency is unchanged).

## Where the person and the name live

- The number becomes a `Person` via `identity.riderByPhone` (found, or created pseudonymously like any
  sign-up), so call, chat, SMS and push reuse the paths every person has. The order gets a participant
  with `role: 'rider'`, `ref: 'rider'`, `label: null` — no name and no number on the order.
- The name he gave lives in `identity_vault.participant_identities` (migration
  `20261008021500_ride_for_someone_else`), keyed by the participant id: «ماما» for him is not her name
  for everyone. Trimmed, cut to 40 characters, empty refused.
- Every read goes through `identity.participantNames` and is logged in `vault_access_logs` with its
  purpose, except when the reader is the rider herself: `ride_rider_name` (the booker's track/history),
  `partner_rider` (the driver's offer and job), `chat_thread`, `notify_ride_for_rider`, `ride_switch`.
  `OrdersService` caches names per reader and participant (at most 2000).

## Who sees what

- **Booker** — `Order.rider = { name }` on his own reads only (`orders.track`, `orders.history`): the
  pill «لـ ماما», the status lines `trip.status.for_*` («السايق جاي لماما» …), the «تتابع مشوار ماما» card
  from the search until she arrives, and «مشوار ماما وصل بالسلامة» at the end. The «وصل، اطلع» moments and
  the curb-near toast are not shown to him (he isn't at the pickup). Receipt and history: «لـ ماما».
- **Driver** — `PartnerOffer.rider` and `PartnerJobStop.rider` (`{ name } | null`): «المشوار لـ أم علي» on
  the offer and the pickup stop, the pickup titled with her name, and «اتصل بالراكب».
- **Rider** — her own push/SMS and the live trip link (a share link made for her, like `safety.share`).

## Call and chat

`ChatService` reads the rider for each ride: the driver's call (`calls.start`) rings the rider's number
(`calleeOf` = rider, else the orderer) on the existing in-app call path — no masked-call provider. The
`customer_courier` thread names the customer side with her name, and the driver's messages reach both
the rider and the booker.

## Notifications

| Template | When | To | Channels |
|---|---|---|---|
| `ride_for_rider` (safety) | `order.matched` | rider | push (if she has the app) + SMS |
| `ride_matched` / `driver_arrived` | driver takes it / is at the pickup | booker (as on every ride) | push |
| `driver_arrived` | driver at the pickup | rider too | push |
| `ride_rider_arrived` (order_updates) | ride completed | booker | push |

The SMS is `${brand}: ` + `sms.ride_for_rider` («{booker} حجزلك مشوار. السايق {driver} جاي بـ{car}، اللوحة
{plate}. تابع المشوار: {link}»), at most 300 characters. A template now may define
`sms: { key, withCode }` (`NotifyTemplateDef`, `render.ts`): when the ride carries a start code (ride
idea s1, the night code) `sms.ride_for_rider_code` is used and the code goes in, because the rider is the
one who reads it out. The lookup `NotifyLookups.startCode` is the seam for it; it is bound once s1's
`OrdersService.startCodeOf` is on the branch. Fallbacks: booker «واحد من أهلك», car «تكسي», plate «—».
The night auto-share to trusted contacts (`trip_shared_contact`) still goes from the booker's list.

## Vehicle switch

`orders.switchRideVehicle` (`docs/api/ride-switch-vehicle.md`) places the new ride for the same rider.

## Demo

- Customer (`apps/customer/scripts/demo-api.mjs`): `POST /demo/ride-for?personId=…` seeds his trusted
  people «أختي زينب» and «أبوي» and an earlier ride for «ماما», so the sheet has people to pick.
- Partner (`apps/partner/scripts/demo-api.mjs`): `POST /demo/offer?who=tuktuk&kind=ride&for=1` — a تكتك
  ride booked for «أم علي».
- Shots: customer `SHOTS=ride` (`ride-for-*`), partner `SHOTS=ridefor`.
