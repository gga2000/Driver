-- Self-fixing door points (maps program a3): the GPS accuracy of the courier's "وصلت" fix, so only
-- precise arrivals (≤ 30 m) teach a saved place where its door is. Additive only; NULL for old rows
-- and for taps sent without a fix.

ALTER TABLE "public"."stops" ADD COLUMN "arrival_accuracy_m" DOUBLE PRECISION;
