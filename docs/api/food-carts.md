# Food carts «عربانات» (2026-10-11)

Ali, 2026-10-11 ("love it go ahead"): the street carts of Aziziyah — liver, falafel, tea, corn, bagilla.
A cart moves and keeps its own hours, so the owner says where he opened tonight («فتحت هنا») and
people who follow the cart hear «أبو حيدر فتح». A customer walks over with a ticket (cash at the cart)
or has the food delivered like any restaurant order.

## Money (no new rule)
A cart is a restaurant org plus a storefront tagged `food_cart` and a `food_carts` row. Like any new
restaurant it starts on the `starter` tier (5 %, Ali 2026-10-12; #300): the Console reminds finance on
day 49 and a person picks the next tier. A delivery order goes through the normal basket and checkout
and is commissioned by the orders path at the store's tier. Collecting a walk-over ticket records the pickup tier
(`AZIZIYAH_MONEY_RULES.commission.pickup`, 5 %) of its cash total. `FOOD_CART_RULES` holds only timings
and limits.

Cart storefronts (and shops, `shop`) stay out of the restaurant lists: `CatalogService.listedStorefronts`
skips `NOT_RESTAURANT_TAGS`; by-id reads (menu, order, reorder) still see them.

## Launch switch
Open in Aziziyah (Ali, 2026-10-12: "open them, and add an option to open and close them in the
consol"). The Console's control page has a «الخدمات الجديدة» card: `ops.controls.setLaunch({ key:
'food_carts', open, reason })` writes a `launch` row in the kill-switch table (admin opens, any
controller closes; audit row `launch.set` and event `ops.launch_switch_set`); `ops.controls.launches`
lists it. With no row the city file's `foodCarts.launched` decides (`ConfigService.foodCartsOpen`); a
failed read uses the last rows read, else the city file, never open by error. Reads go through the
controls switch cache (2 s); the apps re-read the list each minute.

Closed, `list` returns empty lists with `launched: false` (the app shows «العربانات جاية قريب»), `get`,
`follow` and `walkups.place` are `service_paused`, and a cart's delivery order is refused by orders'
controls check (`quote` and `place`) after the kill switches (`ControlsService.assertOrderAllowed`, the
carts module binds which orgs are carts). A food or cart kill switch still stops carts while they are
open. The owner's side works either way, so carts can be set up before they open. Customers reach
carts from a chip on the food page and a card at the end of home, shown while at least one is open.

## Procedures (`foodCarts.*`)
- Customer: `list({ near? })`, `get({ cartId, near? })` (public); `follow({ cartId, on })`;
  `walkups.place({ cartId, lines, note? })` (priced on the server, 3-digit code, at most 3 open
  tickets), `walkups.mine()`, `walkups.cancel({ walkupId })` (only before the cart starts it).
- Sizes and extras (Ali 2026-10-12): a dish's menu modifier groups. The cart's own editor writes sizes
  as a required pick-one group priced from the cheapest size and extras as a pick-any group. `CartDish`
  carries them as `groups`; a walk-over line sends `choices: [{ groupId, optionId }]`, which the server
  checks (`modifier_invalid`) and prices like a delivery order's modifiers. `WalkupLine.priceIqd` is one
  unit with its picks, and `choices` gives their names.
- Owner (Merchant app cart mode, `MERCHANT_ADMIN_ROLES`): `owner.mode`, `owner.get`,
  `owner.openHere({ at, label?, closesAt? })`, `owner.close`, `owner.settings({ usual?, awayNote? })`,
  `owner.ready`, `owner.reject`, `owner.collect({ walkupId, code })`.

## Notifications
| Event | Template | To | Rule |
|---|---|---|---|
| `food_cart.opened` | `food_cart_opened` «{cart} فتح» | each follower | category `food_cart` (promotional, pref `foodCarts`, on by default); once per cart per Baghdad day (`food_cart_open:<cartId>:<localDate>`); nothing for an opening 23:00–08:00 by the event's own clock; opens `driver://food-carts/{cartId}` |
| `food_cart.walkup_ready` | `food_cart_walkup_ready` «طلبك جاهز عند {cart}» | the ticket's owner | `order_updates`, channel `orders`, any hour; opens the ticket |
| `food_cart.walkup_rejected` (`why: 'cart'`) | `food_cart_walkup_rejected` | the ticket's owner | as above; nothing was paid |
| `food_cart.walkup_rejected` (`why: 'closed'`) | `food_cart_walkup_closed` | the ticket's owner | the cart closed before starting it |

## Demo
Customer demo API: `POST /demo/carts?personId=…[&ticket=placed|ready]`, `/demo/carts/open|close?key=`.
Merchant demo API: owner `0770 123 4500` (كبدة أبو حيدر); `POST /demo/carts/close|open|tickets`.
