-- Joy J5a o3 / o8: how many a dish (or one of its versions) feeds, set by the kitchen («يشبّع 2–3»),
-- and the kitchen's own dish labels (spicy / new / for the family). Additive only; NULL = not said.

ALTER TABLE "public"."catalog_items" ADD COLUMN "serves_min" INTEGER,
ADD COLUMN "serves_max" INTEGER,
ADD COLUMN "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "public"."modifiers" ADD COLUMN "serves_min" INTEGER,
ADD COLUMN "serves_max" INTEGER;
