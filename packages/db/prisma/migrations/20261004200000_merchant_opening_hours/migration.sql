-- Merchant opening hours (Driver Merchant "الدوام"): the weekly schedule with split shifts and dated
-- holiday closures, set by the store's owner. Additive and nullable: NULL opening_hours means the
-- catalog's seeded hours still apply; NULL holiday_closures means none.
ALTER TABLE "public"."orgs" ADD COLUMN "opening_hours" JSONB,
ADD COLUMN "holiday_closures" JSONB,
ADD COLUMN "hours_updated_at" TIMESTAMP(3);
