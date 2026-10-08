-- «جهّز محلك» (merchant setup): a new shop's first day. `orgs.setup` holds what the owner confirmed (what
-- he sells, how he gets paid, the kitchen checks), when he raised the shutter and the shop's first real
-- order; NULL is every shop from before setup, for which nothing changes. `catalog_items.photo_library`
-- marks a dish photo taken from Driver's library (its slug), shown to customers as «صورة توضيحية» until
-- the kitchen's own photo replaces it. Additive only; no table is created.
ALTER TABLE "public"."orgs" ADD COLUMN "setup" JSONB;
ALTER TABLE "public"."catalog_items" ADD COLUMN "photo_library" TEXT;
