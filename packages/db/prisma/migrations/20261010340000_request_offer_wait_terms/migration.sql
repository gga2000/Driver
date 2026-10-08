-- w1 (Ali 2026-10-07): on a «يستناك وترجع» private-car request each driver's offer says how many
-- hours of waiting its price includes and what each extra hour costs. Both set or both empty.
ALTER TABLE "public"."ride_request_offers" ADD COLUMN "wait_included_hours" INTEGER,
ADD COLUMN "extra_hour_iqd" INTEGER;

ALTER TABLE "public"."ride_request_offers" ADD CONSTRAINT "ride_request_offers_wait_terms_check"
  CHECK (
    ("wait_included_hours" IS NULL AND "extra_hour_iqd" IS NULL)
    OR ("wait_included_hours" BETWEEN 0 AND 12 AND "extra_hour_iqd" >= 0)
  );
