-- الرجعة seat PIN safeguards (Ali 2026-10-06: the PIN stays on the rider's lock screen, "but record
-- which user input which pin and if another user input the pin for other user"). Every PIN a driver
-- types at a departure is one row: who typed it, on which departure and seat (booking), which booking
-- the PIN actually belongs to, what it did, and whether it raised an ops alert (a rider's PIN on
-- another rider's seat, or the 3rd refused PIN on one seat). Ids only, never the PIN; no foreign
-- keys, so the log outlives the rows it names. Append-only like the ledger. Additive only.

CREATE TABLE "public"."intercity_pin_attempts" (
    "id" TEXT NOT NULL,
    "departure_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "target_booking_id" TEXT,
    "matched_booking_id" TEXT,
    "result" TEXT NOT NULL,
    "alert" TEXT,
    "refused_on_seat" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intercity_pin_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "intercity_pin_attempts_departure_id_at_idx" ON "public"."intercity_pin_attempts"("departure_id", "at");

CREATE INDEX "intercity_pin_attempts_city_id_alert_at_idx" ON "public"."intercity_pin_attempts"("city_id", "alert", "at");

CREATE INDEX "intercity_pin_attempts_driver_id_at_idx" ON "public"."intercity_pin_attempts"("driver_id", "at");

-- Evidence is never edited or removed by the application (reject_mutation from the m2 migration).
CREATE TRIGGER "intercity_pin_attempts_append_only"
  BEFORE UPDATE OR DELETE ON "public"."intercity_pin_attempts"
  FOR EACH ROW EXECUTE FUNCTION "public"."reject_mutation"();

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
