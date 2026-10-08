# Sharing a private car by link (`routes.requestBoard.*Share*`)

Private car round 2 step 6, Ali's item 56 and rules s1–s4 (round-2 design page, screen 6). Server:
`apps/api/src/modules/routes/request-board.service.ts` (step 6 section). Migration
`20261010330000_request_shares` (`ride_request_shares` + four `share_*` columns on `ride_requests`).

## Switch `MoneyRules.requestSharing` (off as shipped)

`{ enabled: false, closeBeforeMin: 120 }`. While off no link can be opened, codes read as not found and
nobody holds anything. Turning it on is Ali's call.

## Rules

- **Who can share (s1):** the booker of a picked (`matched`) private car posted for 2 people or more,
  until joining closes. Everyone in the car is the people he posted for (`seats`); he says how many of
  them are his own (`bookerPlaces`, him and his family).
- **One even price (s2):** a place costs the picked price over the people, rounded down to 250
  (`sharePlaceIqd`; 110,000 ÷ 4 = 27,500). It is fixed when the link opens; the booker carries the rounding.
- **A friend joins** from the link with 1–6 places, paid from his wallet: the amount is held (it counts
  in `walletHolds`, so it can't be spent twice on seats or deposits) until the trip ends. One join per
  person; to change his places he leaves and joins again. The booker and the picked driver can't join.
- **Joining closes** `closeBeforeMin` (2 h) before the trip. Until then a friend may leave and his hold is
  released at once. Places nobody took stay the booker's, in cash (s3).
- **Trip completes:** each friend's held places are paid from his own wallet straight to the driver
  (`order.closed` ride `sharedBy`); the booker owes the rest, his deposit first (never more than his part),
  then cash: `cash = max(0, fare − friends − deposit)`. The driver's take is on the whole fare.
- **Any other end (s4):** rider cancel (free or late), driver no-show, rider no-show → every friend's
  hold is released. The booker's deposit follows the usual rules unchanged.

| procedure | who | does |
|---|---|---|
| `openShare({postId, bookerPlaces=1})` | booker | opens the link, or changes his own places (never below what friends hold: `share_full`) |
| `shareInvite({code})` | anyone signed in but the booker and driver | the trip, the picked driver's card, the booker's first name, one place's price, places left, his own places. After the trip only people who joined may read it |
| `joinShare({code, places=1})` | friend | holds `places × placeIqd` on his wallet |
| `leaveShare({code})` | friend | before joining closes |
| `sharedWithMe()` | friend | his shared cars still ahead or on the road |

Views: `RequestPostView.share` (booker: link path and friends' first names, vault purpose
`request_share_member`; picked driver: no names, no link) with `placeIqd`, `placesLeft`, `friendsIqd`,
`cashIqd`, and `shareable`. `DriverRequestRide.cashToCollectIqd` now subtracts what friends paid. The
friend's view reads the booker's first name under `request_share_booker`.

Errors: `share_not_found`, `share_closed`, `share_full`, plus `wallet_insufficient`, `forbidden`,
`request_state_conflict`, `invalid_input`.

Events (aggregate `ride_request`, not ledger events): `request.share_opened`, `request.share_joined`,
`request.share_left`, `request.shares_released {personIds, reason}`. No pushes yet (lane D can add them).

Not built: a per-friend boarding code (private cars have none today; friends ride with the booker), and
any change to who pays a no-show.

Demo: `POST /demo/rajaa/share?personId=…&as=booker|friend[&joined=1][&open=0][&postId=…]` (customer demo
API). Screenshots: `SHOTS=share node scripts/web-shots.mjs` in `apps/customer`.
