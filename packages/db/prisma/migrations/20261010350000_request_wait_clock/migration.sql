-- w2: the waiting clock on a private «يستناك وترجع» trip. The driver starts it when he drops the
-- rider and stops it when the rider is back in the car; an end never comes before its start.
ALTER TABLE "public"."ride_requests" ADD COLUMN "wait_started_at" TIMESTAMP(3),
ADD COLUMN "wait_ended_at" TIMESTAMP(3);

ALTER TABLE "public"."ride_requests" ADD CONSTRAINT "ride_requests_wait_clock_check"
  CHECK ("wait_ended_at" IS NULL OR ("wait_started_at" IS NOT NULL AND "wait_ended_at" >= "wait_started_at"));
