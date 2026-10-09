-- Step 5 (Ali's price items 51 and 52): children on a lap ride free, and a seat booked together with
-- the seat back on the same road takes the return discount (switch MoneyRules.intercityReturnBundle).

-- AlterTable
ALTER TABLE "public"."seat_bookings" ADD COLUMN "lap_children" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "return_discount_iqd" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "return_pair_id" TEXT,
ADD CONSTRAINT "seat_bookings_lap_children_check" CHECK ("lap_children" BETWEEN 0 AND 3),
ADD CONSTRAINT "seat_bookings_return_discount_check" CHECK ("return_discount_iqd" >= 0);
