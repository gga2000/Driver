-- «أني نازل» (customer joy spec J-D8): when the courier is at the door and can't reach the customer,
-- the customer's tap buys 2 more free minutes before the courier may mark the order failed, once per
-- stop. This column records when, so a second tap is a no-op and the courier's screen says
-- «الزبون نازل». Additive and nullable; cleared together with unreachable_started_at.
ALTER TABLE "public"."trips" ADD COLUMN "unreachable_extended_at" TIMESTAMP(3);
