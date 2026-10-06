-- Joy r2, «شلون كانت الرجعة؟»: the rider's stars and chips after a completed الرجعة trip
-- ({stars, tags, at}), once per booking. Additive only; NULL = not rated.

ALTER TABLE "public"."seat_bookings" ADD COLUMN "rating" JSONB;
