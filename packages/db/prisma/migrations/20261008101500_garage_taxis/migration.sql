-- Taxi ideas x2/x3/x4 (+ n10): taxis linked to a الرجعة seat — the ride that takes the rider to his
-- car's garage (`to_garage`, with what the late notice last told) and the taxi armed to wait at the
-- Aziziyah garage on the way back (`from_garage`). Ids, pins and times only (names stay in
-- identity_vault). Additive only.

-- CreateTable
CREATE TABLE "public"."garage_taxis" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "departure_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "order_id" TEXT,
    "garage_id" TEXT,
    "place_id" TEXT,
    "pin_lat" DOUBLE PRECISION,
    "pin_lng" DOUBLE PRECISION,
    "zone_id" TEXT,
    "payment_method" TEXT NOT NULL,
    "depart_at" TIMESTAMP(3) NOT NULL,
    "pickup_at" TIMESTAMP(3),
    "ride_min" INTEGER,
    "expected_at" TIMESTAMP(3),
    "late_min" INTEGER,
    "told_min" INTEGER,
    "told_at" TIMESTAMP(3),
    "fail_code" TEXT,
    "drop_reason" TEXT,
    "placed_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "garage_taxis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "garage_taxis_kind_state_idx" ON "public"."garage_taxis"("kind", "state");

-- CreateIndex
CREATE INDEX "garage_taxis_order_id_idx" ON "public"."garage_taxis"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "garage_taxis_booking_id_kind_key" ON "public"."garage_taxis"("booking_id", "kind");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
