-- Private car on the Baghdad/Kut board (ideas y1, y4, Ali 2026-10-07). Additive only.
--
-- `details`: what the rider asks for, which the drivers price on: one way / wait and come back /
-- back another day, big bags, the car wanted, AC. `seen_driver_ids`: drivers who opened the request
-- (ids only); the rider sees «N سواق شافوا طلبك».

ALTER TABLE "public"."ride_requests" ADD COLUMN     "details" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "seen_driver_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
