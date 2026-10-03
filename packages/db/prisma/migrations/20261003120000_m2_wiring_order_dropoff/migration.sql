-- M2 wiring (dispatch auto-assign): the customer's delivery point on the order, {zoneKey, pin?}.
-- Additive and nullable: orders placed before it keep NULL and dispatch falls back to the zone centre.
ALTER TABLE "public"."orders" ADD COLUMN "dropoff" JSONB;
