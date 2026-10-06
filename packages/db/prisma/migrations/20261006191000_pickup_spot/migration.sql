-- Pickup spot (maps program r7): where couriers collect a restaurant's orders — a short note and up to
-- two photos (upload ids, read through signed URLs only), set by the store's owner in Driver Merchant
-- and shown to the assigned courier on the pickup stop of his job. Additive only: no note, no photos
-- and NULL pickup_updated_at mean the spot was never set.

ALTER TABLE "public"."orgs" ADD COLUMN "pickup_note" TEXT,
ADD COLUMN "pickup_photo_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "pickup_updated_at" TIMESTAMP(3);
