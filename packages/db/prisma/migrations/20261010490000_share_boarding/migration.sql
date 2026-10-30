-- Private car round 2, shared car way C (Ali 2026-10-09: "c"): each friend taps «صعدت» next to the car,
-- or the driver taps «صعد» for him. When, and who said so. No new table.

-- AlterTable
ALTER TABLE "public"."ride_request_shares" ADD COLUMN     "boarded_at" TIMESTAMP(3),
ADD COLUMN     "boarded_by" TEXT,
ADD CONSTRAINT "ride_request_shares_boarded_check" CHECK (
  ("boarded_at" IS NULL AND "boarded_by" IS NULL)
  OR ("boarded_at" IS NOT NULL AND "boarded_by" IN ('self', 'driver'))
);
