-- طرود (Ali 2026-10-12): parcels inside the city. One row per parcel: ids, the parcel's own words,
-- the fare and the receipt code. The receiver's name and number stay in identity_vault; the door
-- link's token (and the texted link's own) is kept only as its sha-256; the texts' times sit beside them. A new table beside the older per-order `parcels` (unused so far). Additive only.

-- CreateTable
CREATE TABLE "public"."parcel_sends" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "client_request_id" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "declared_value_iqd" INTEGER NOT NULL,
    "photo_upload_id" TEXT,
    "recipient_person_id" TEXT NOT NULL,
    "pickup" JSONB NOT NULL,
    "door_by" TEXT NOT NULL,
    "zone_key" TEXT NOT NULL,
    "dropoff" JSONB,
    "payer" TEXT NOT NULL,
    "fare_iqd" INTEGER NOT NULL,
    "courier_note" TEXT,
    "pin" TEXT NOT NULL,
    "door_token_hash" TEXT,
    "door_due_at" TIMESTAMP(3),
    "door_set_at" TIMESTAMP(3),
    "order_id" TEXT,
    "pin_fails" INTEGER NOT NULL DEFAULT 0,
    "pin_verified_at" TIMESTAMP(3),
    "refused_at" TIMESTAMP(3),
    "door_text_due_at" TIMESTAMP(3),
    "door_texted_at" TIMESTAMP(3),
    "pin_texted_at" TIMESTAMP(3),
    "text_token_hash" TEXT,
    "text_capped" BOOLEAN NOT NULL DEFAULT false,
    "pickup_photo_upload_id" TEXT,
    "receiver_known" BOOLEAN NOT NULL DEFAULT false,
    "stage" TEXT NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcel_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parcel_sends_door_token_hash_key" ON "public"."parcel_sends"("door_token_hash");

-- CreateIndex
CREATE INDEX "parcel_sends_sender_id_created_at_idx" ON "public"."parcel_sends"("sender_id", "created_at");

-- CreateIndex
CREATE INDEX "parcel_sends_stage_door_due_at_idx" ON "public"."parcel_sends"("stage", "door_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "parcel_sends_text_token_hash_key" ON "public"."parcel_sends"("text_token_hash");

-- CreateIndex
CREATE INDEX "parcel_sends_stage_door_text_due_at_idx" ON "public"."parcel_sends"("stage", "door_text_due_at");

-- CreateIndex
CREATE INDEX "parcel_sends_recipient_person_id_created_at_idx" ON "public"."parcel_sends"("recipient_person_id", "created_at");

-- CreateIndex
CREATE INDEX "parcel_sends_order_id_idx" ON "public"."parcel_sends"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "parcel_sends_sender_id_client_request_id_key" ON "public"."parcel_sends"("sender_id", "client_request_id");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
