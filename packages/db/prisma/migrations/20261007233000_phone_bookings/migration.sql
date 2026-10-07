-- «حجز بالتلفون» (taxi/tuktuk step 4): rides staff booked from the Console for a caller without the
-- app. The ride is an ordinary order of the caller's person; this row records who booked it and the
-- landmarks picked. Ids and place names only (the number and name stay in identity_vault). Additive only.

-- CreateTable
CREATE TABLE "public"."phone_bookings" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "booked_by" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "pickup_id" TEXT NOT NULL,
    "pickup_name" TEXT NOT NULL,
    "dropoff_id" TEXT NOT NULL,
    "dropoff_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phone_bookings_city_id_created_at_idx" ON "public"."phone_bookings"("city_id", "created_at");

-- CreateIndex
CREATE INDEX "phone_bookings_person_id_idx" ON "public"."phone_bookings"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "phone_bookings_order_id_key" ON "public"."phone_bookings"("order_id");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
