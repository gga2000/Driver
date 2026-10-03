-- Review 2026-10-04 #2: a fleet link needs the driver's consent before the owner sees his name,
-- money, documents or live state. Existing links were made without it, so they start pending
-- (accepted_at NULL) and the driver accepts them in the Partner app (`fleet.respondInvite`).
ALTER TABLE "public"."fleet_drivers" ADD COLUMN "accepted_at" TIMESTAMP(3);
