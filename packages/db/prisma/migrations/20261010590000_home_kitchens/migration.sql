-- أكل بيت (home kitchens, 2026-10-11): how a home kitchen sells each dish, ready today or by reservation.
-- NULL on every restaurant dish; no new table, so no lock-down call.
ALTER TABLE "public"."catalog_items" ADD COLUMN "home_sale" JSONB;
