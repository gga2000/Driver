-- Landmarks on the map (maps program b3): a landmark place's category picks its icon on every map
-- (mosque, school, market, clinic, fuel, bridge, garage, other). NULL on older rows and on places that
-- are not landmarks: the API derives the category from the name then (`landmarkCategoryOf`). Additive only.

-- AlterTable
ALTER TABLE "public"."places" ADD COLUMN "landmark_category" TEXT;

ALTER TABLE "public"."places"
    ADD CONSTRAINT "places_landmark_category_check" CHECK ("landmark_category" IS NULL OR "landmark_category" IN ('mosque', 'school', 'market', 'clinic', 'fuel', 'bridge', 'garage', 'other'));
