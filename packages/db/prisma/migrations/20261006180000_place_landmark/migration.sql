-- Landmark address (maps program a2): the landmark a customer said a saved place is near ("يم الجامع
-- الكبير"), within 500 m of the pin. An id from `places.landmarks` — a seeded garage or meeting point
-- (`lm_<key>`, not a row) or an approved landmark place — so no foreign key. Additive only; NULL = none.

ALTER TABLE "public"."places" ADD COLUMN "landmark_id" TEXT;
