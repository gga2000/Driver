-- Step 4 agreed trip prices (Ali 2026-10-07; design votes 2026-10-08): a rider asks a departure's driver to
-- price a pickup from his pin on the way or a drop at a door; the driver names the price (whole 1,000s,
-- 0 = free); booking locks it. docs/specs/2026-10-08-agreed-trip-prices.md

-- AlterTable
ALTER TABLE "public"."seat_bookings" ADD COLUMN "dropoff" JSONB,
ADD COLUMN "dropoff_fee_iqd" INTEGER NOT NULL DEFAULT 0;

-- Step 4b a6 «احجز وادفع كاش» on a private car (money switch requestCashReservation, off): the rider asks
-- the driver who offered, the driver accepts, the pick holds no deposit.
-- AlterTable
ALTER TABLE "public"."ride_requests" ADD COLUMN "cash_reserved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."ride_request_offers" ADD COLUMN "cash_state" TEXT,
ADD CONSTRAINT "ride_request_offers_cash_state_check" CHECK ("cash_state" IS NULL OR "cash_state" IN ('asked', 'accepted', 'declined'));

-- CreateTable
CREATE TABLE "public"."trip_agreements" (
    "id" TEXT NOT NULL,
    "departure_id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "state" TEXT NOT NULL,
    "amount_iqd" INTEGER,
    "asked_at" TIMESTAMP(3) NOT NULL,
    "proposed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "booking_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_agreements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trip_agreements_kind_check" CHECK ("kind" IN ('pin_pickup', 'door_drop')),
    CONSTRAINT "trip_agreements_state_check" CHECK ("state" IN ('asked', 'proposed', 'accepted', 'declined', 'expired', 'withdrawn', 'used')),
    CONSTRAINT "trip_agreements_amount_check" CHECK ("amount_iqd" IS NULL OR ("amount_iqd" BETWEEN 0 AND 25000 AND "amount_iqd" % 1000 = 0))
);

-- CreateIndex
CREATE INDEX "trip_agreements_departure_id_idx" ON "public"."trip_agreements"("departure_id");

-- CreateIndex
CREATE INDEX "trip_agreements_rider_id_idx" ON "public"."trip_agreements"("rider_id");

-- CreateIndex
CREATE INDEX "trip_agreements_state_expires_at_idx" ON "public"."trip_agreements"("state", "expires_at");

SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
