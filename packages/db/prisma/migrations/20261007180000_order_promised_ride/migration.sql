-- The honest-delay promise uses the learned ETA (Ali, 2026-10-07: "yes learned data"): the kitchen → door
-- ride minutes are locked into the order when it is placed (the one ETA's learned minutes, factor clamped
-- 0.7–1.6; router minutes when nothing is learned), so the promised time and its late-credit deadline
-- never move after placement. Null on rows placed before this column: their promise stays on the
-- router's own minutes. Additive only.

-- AlterTable
ALTER TABLE "public"."orders" ADD COLUMN "promised_ride_min" INTEGER;
