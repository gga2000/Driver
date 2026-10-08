-- PLACEHOLDER timestamp: the coordinator assigns the real stamp before merge (docs/launch/migrations.md).
-- Shop rules (Ali, 2026-10-08). r5: busy mode is +10 or +20 minutes, picked when it is switched on;
-- `orgs.busy_extra_min` holds the pick (NULL keeps today's +10). p4: a dish photo the shop uploads shows
-- to customers at once and Driver's team checks it the same day; `catalog_items.photo_review_pending_at`
-- is when it went up unreviewed (NULL = nothing waiting). Additive only; no table is created.
ALTER TABLE "public"."orgs" ADD COLUMN "busy_extra_min" INTEGER;
ALTER TABLE "public"."catalog_items" ADD COLUMN "photo_review_pending_at" TIMESTAMP(3);
