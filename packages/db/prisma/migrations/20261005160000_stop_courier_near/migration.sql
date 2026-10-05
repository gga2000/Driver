-- "Almost there" (maps program SP5b): when a live fix first comes within NEAR_DROPOFF_M of a drop-off the
-- stop records it, so the customer is told once. Additive and nullable.
ALTER TABLE "public"."stops" ADD COLUMN "courier_near_at" TIMESTAMP(3);
