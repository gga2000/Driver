-- Partner redesign f5: a fleet owner invites a driver and picks his car on one screen. The car waits on
-- the invite and becomes his when he accepts (if it is still free); answering the invite clears it.
-- Additive only: one nullable column, no new table.
ALTER TABLE "public"."fleet_drivers" ADD COLUMN "planned_vehicle_id" TEXT;
