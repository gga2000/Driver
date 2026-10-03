-- الرجعة backend (routes module): announced departures, seat bookings, the demand board and the
-- request board. Additive only: new enums, new columns on departures (all nullable or defaulted),
-- four new tables. `seats` (one row per position, unique per departure) is left as it is; a rider's
-- booking of a position is a `seat_bookings` row, so a position cancelled and re-sold gets a new
-- booking id (and a new ledger seat id).

-- ───────────── enums ─────────────
CREATE TYPE "public"."IntercityDirection" AS ENUM ('to_aziziyah', 'from_aziziyah');
CREATE TYPE "public"."SeatBookingState" AS ENUM ('held', 'booked', 'checked_in', 'completed', 'cancelled_by_rider', 'no_show', 'moved', 'expired', 'cancelled');
CREATE TYPE "public"."DemandPostState" AS ENUM ('open', 'claimed', 'expired', 'cancelled', 'lapsed');
CREATE TYPE "public"."RideRequestState" AS ENUM ('open', 'matched', 'driver_arrived', 'completed', 'cancelled', 'expired', 'rider_no_show', 'driver_no_show');
CREATE TYPE "public"."RideRequestOfferState" AS ENUM ('open', 'picked', 'withdrawn', 'lost');

-- ───────────── departures: corridor, garage, vehicle, run state ─────────────
ALTER TABLE "public"."departures" ADD COLUMN "corridor_id" TEXT;
ALTER TABLE "public"."departures" ADD COLUMN "garage_id" TEXT;
ALTER TABLE "public"."departures" ADD COLUMN "direction" "public"."IntercityDirection";
ALTER TABLE "public"."departures" ADD COLUMN "from_city_id" TEXT;
ALTER TABLE "public"."departures" ADD COLUMN "to_city_id" TEXT;
ALTER TABLE "public"."departures" ADD COLUMN "seat_layout" INTEGER;
ALTER TABLE "public"."departures" ADD COLUMN "vehicle_snapshot" JSONB;
ALTER TABLE "public"."departures" ADD COLUMN "family_only" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."departures" ADD COLUMN "seat_price_iqd" INTEGER;
ALTER TABLE "public"."departures" ADD COLUMN "front_premium_iqd" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "public"."departures" ADD COLUMN "selfie_at" TIMESTAMP(3);
ALTER TABLE "public"."departures" ADD COLUMN "run_state" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "public"."departures" ADD COLUMN "low_fill_checked_at" TIMESTAMP(3);

CREATE INDEX "departures_garage_id_scheduled_at_idx" ON "public"."departures"("garage_id", "scheduled_at");
CREATE INDEX "departures_corridor_id_direction_scheduled_at_idx" ON "public"."departures"("corridor_id", "direction", "scheduled_at");
CREATE INDEX "departures_driver_id_scheduled_at_idx" ON "public"."departures"("driver_id", "scheduled_at");

-- ───────────── tables ─────────────
CREATE TABLE "public"."seat_bookings" (
    "id" TEXT NOT NULL,
    "departure_id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "seat_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "selection" TEXT NOT NULL,
    "travelling_as" "public"."TravellingAs" NOT NULL,
    "state" "public"."SeatBookingState" NOT NULL DEFAULT 'held',
    "origin" TEXT NOT NULL,
    "seat_price_iqd" INTEGER NOT NULL,
    "front_premium_iqd" INTEGER NOT NULL DEFAULT 0,
    "pickup_fee_iqd" INTEGER NOT NULL DEFAULT 0,
    "payment" TEXT,
    "prepaid" BOOLEAN NOT NULL DEFAULT false,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "pin" TEXT NOT NULL,
    "pickup" JSONB NOT NULL,
    "large_bags" BOOLEAN NOT NULL DEFAULT false,
    "held_until" TIMESTAMP(3),
    "booked_at" TIMESTAMP(3),
    "at_garage_at" TIMESTAMP(3),
    "checked_in_at" TIMESTAMP(3),
    "no_show_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "late_minutes" INTEGER,
    "demand_post_id" TEXT,
    "moved_from_booking_id" TEXT,
    "moved_to_booking_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "seat_bookings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."demand_posts" (
    "id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "corridor_id" TEXT NOT NULL,
    "direction" "public"."IntercityDirection" NOT NULL,
    "garage_id" TEXT,
    "pickup" JSONB NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "seats" INTEGER NOT NULL,
    "travelling_as" "public"."TravellingAs" NOT NULL,
    "state" "public"."DemandPostState" NOT NULL DEFAULT 'open',
    "booking_id" TEXT,
    "escalated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "demand_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ride_requests" (
    "id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "from_place" JSONB NOT NULL,
    "to_place" JSONB NOT NULL,
    "city_id" TEXT,
    "when" TIMESTAMP(3) NOT NULL,
    "seats" INTEGER NOT NULL,
    "private_car" BOOLEAN NOT NULL DEFAULT true,
    "travelling_as" "public"."TravellingAs" NOT NULL,
    "note" TEXT,
    "state" "public"."RideRequestState" NOT NULL DEFAULT 'open',
    "origin" TEXT NOT NULL DEFAULT 'rider',
    "price_cap_iqd" INTEGER,
    "picked_offer_id" TEXT,
    "deposit_iqd" INTEGER,
    "driver_arrived_at" TIMESTAMP(3),
    "driver_arrived_pin" JSONB,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ride_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ride_request_offers" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "price_iqd" INTEGER NOT NULL,
    "state" "public"."RideRequestOfferState" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ride_request_offers_pkey" PRIMARY KEY ("id")
);

-- ───────────── indexes ─────────────
CREATE INDEX "seat_bookings_departure_id_state_idx" ON "public"."seat_bookings"("departure_id", "state");
CREATE INDEX "seat_bookings_rider_id_state_idx" ON "public"."seat_bookings"("rider_id", "state");
CREATE INDEX "demand_posts_corridor_id_direction_state_window_start_idx" ON "public"."demand_posts"("corridor_id", "direction", "state", "window_start");
CREATE INDEX "demand_posts_rider_id_idx" ON "public"."demand_posts"("rider_id");
CREATE INDEX "ride_requests_state_when_idx" ON "public"."ride_requests"("state", "when");
CREATE INDEX "ride_requests_rider_id_idx" ON "public"."ride_requests"("rider_id");
CREATE INDEX "ride_request_offers_request_id_idx" ON "public"."ride_request_offers"("request_id");
CREATE INDEX "ride_request_offers_driver_id_idx" ON "public"."ride_request_offers"("driver_id");

-- ───────────── foreign keys ─────────────
ALTER TABLE "public"."seat_bookings" ADD CONSTRAINT "seat_bookings_departure_id_fkey" FOREIGN KEY ("departure_id") REFERENCES "public"."departures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."ride_request_offers" ADD CONSTRAINT "ride_request_offers_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── updated_at triggers (as every table with updated_at) ─────────────
CREATE TRIGGER "seat_bookings_set_updated_at" BEFORE UPDATE ON "public"."seat_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "demand_posts_set_updated_at" BEFORE UPDATE ON "public"."demand_posts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "ride_requests_set_updated_at" BEFORE UPDATE ON "public"."ride_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "ride_request_offers_set_updated_at" BEFORE UPDATE ON "public"."ride_request_offers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
