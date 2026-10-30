-- «جهّز محلك» (merchant setup): a new shop's first day. `orgs.setup` holds what the owner confirmed (what
-- he sells, how he gets paid, the kitchen checks), when he raised the shutter and the shop's first real
-- order; NULL is every shop from before setup, for which nothing changes. `catalog_items.photo_library`
-- marks a dish photo taken from Driver's library (its slug), shown to customers as «صورة توضيحية» until
-- the kitchen's own photo replaces it. Additive only; no table is created.
ALTER TABLE "public"."orgs" ADD COLUMN "setup" JSONB;
ALTER TABLE "public"."catalog_items" ADD COLUMN "photo_library" TEXT;

-- Shop rules (Ali, 2026-10-08). r5: busy mode is +10 or +20 minutes, picked when it is switched on;
-- `orgs.busy_extra_min` holds the pick (NULL keeps today's +10). p4: a dish photo the shop uploads shows
-- to customers at once and Driver's team checks it the same day; `catalog_items.photo_review_pending_at`
-- is when it went up unreviewed (NULL = nothing waiting).
ALTER TABLE "public"."orgs" ADD COLUMN "busy_extra_min" INTEGER;
ALTER TABLE "public"."catalog_items" ADD COLUMN "photo_review_pending_at" TIMESTAMP(3);
