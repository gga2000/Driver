-- x3 (2026-10-07): when our taxi to a الرجعة seat's garage is due while it runs late for the car.
-- Holds the seat only while the RIDE_SEAT_HOLD switch is on (off until Ali confirms the no-show rule).
ALTER TABLE "public"."seat_bookings" ADD COLUMN "taxi_late_until" TIMESTAMP(3);
