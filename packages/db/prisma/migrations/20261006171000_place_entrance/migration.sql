-- Which gate (maps program a4): the entrance a customer marked on a saved place, {"lat","lng"} within
-- 150 m of the pin. Couriers navigate and arrive there. Additive only; NULL = the pin itself.

ALTER TABLE "public"."places" ADD COLUMN "entrance" JSONB;
