-- Driver profile (Baghdad/Kut ideas x12–x17, Ali 2026-10-07). Additive only.
--
-- «كلمة عن السفرة» (x14): with his stars a rider may write one line (140 characters, no phone numbers,
-- links or handles). Other riders read it on the driver's profile without the writer's name, newest
-- first; support can hide a line (kept, logged as `review.hidden`, reversible). `review_at` orders the
-- Console list.

ALTER TABLE "public"."seat_bookings" ADD COLUMN     "review_hidden_at" TIMESTAMP(3),
ADD COLUMN     "review_hidden_by" TEXT,
ADD COLUMN     "review_hidden_reason" TEXT,
ADD COLUMN     "review_at" TIMESTAMP(3),
ADD COLUMN     "review_text" TEXT;

CREATE INDEX "seat_bookings_review_at_idx" ON "public"."seat_bookings"("review_at");
