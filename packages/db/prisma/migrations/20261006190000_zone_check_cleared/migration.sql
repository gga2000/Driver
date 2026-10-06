-- «تم الفحص» (Ali, 2026-10-06): a driver's "لا" flags a zone and holds its confirmation until the team
-- checks it. The team can now mark the flag checked in the Console without redrawing the outline: the
-- "no" answers given so far record who cleared them and when, and stop flagging or holding the zone. A
-- later "no" flags it again. No new table. Additive only.

ALTER TABLE "public"."zone_checks" ADD COLUMN "cleared_at" TIMESTAMP(3),
ADD COLUMN "cleared_by_id" TEXT;
