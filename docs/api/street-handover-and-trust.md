# «بالشارع · توفّر 250 دينار» carried end to end (HUNT-02)

Before: the checkout option only lowered the delivery fee. The order never said «بالشارع», so the
courier went to the door anyway or the customer waited at a street the courier knew nothing about.

Now the server keeps the choice exactly as it priced it:

- `orders.place` with `options.streetHandover: true` on a delivery: the server quote includes the
  `street_pickup` discount (−250 in Aziziyah), and the stored drop-off point gets `streetHandover: true`
  (`ServerFees.streetHandover`). A client cannot set the flag on the point itself (`placeLink` rebuilds
  the point and drops it); only the priced option counts. A door pickup (`doorPickup`) or a ride never
  carries it.
- The `Order` view has `streetHandover: true` for such an order (absent otherwise): the receipt and the
  live screen can say «بالشارع» next to the lower fee.
- The courier's job (`partner.activeJob`): the drop-off stop has `streetHandover: true`. The customer
  comes out to the street near the pin; the courier calls when close instead of walking to the door.
- No money change: the fee is the one already charged.

Not in this change: a curated meeting point per zone (the copy «تلاقيه بنقطة قريبة» promises a point;
today it means the street nearest the pin). The screens (receipt line, live screen, job card wording)
belong to the food/live-screen and partner threads.

## Where and when the server trusts the app (FOOD-03, FOOD-15)

- **The drop-off zone comes from the pin (FOOD-15).** At `orders.place` a pinned point's zone is the
  server's own reading of the pin (the places module's zone resolver), not the `zoneKey` the app sent;
  that zone sets the delivery fee. A pin outside the service area (more than 2 km past the nearest
  zone) is refused with `outside_zone`. A point without a pin keeps its zone.
- **Pre-orders are for real slots (FOOD-03).** A shop order's `scheduledFor` must be at least 10
  minutes away (the kitchen's scheduling lead; sooner is a now-order) and at most 48 hours ahead
  («اليوم» and «باچر»), else `order_schedule_invalid` («هذا الوقت ما ينفع للطلب. اختار وقت من اليوم أو
  باچر»). A past time no longer slips past the opening hours, the hand-close or the night fee.
- **A shop closed by hand (or on holiday) today** takes no pre-order for later today
  (`merchant_paused`); a pre-order for tomorrow still goes in.
