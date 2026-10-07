-- Taxi/tuktuk step 3 (ride ideas d1, n1, n2): what a rider sees about the car. Additive only.
--
-- The model ("Toyota Corolla") and the body colour (one of `VehicleColour`, the real paint shown as a dot
-- beside the model) come from the fleet owner's add-vehicle form. Features: the driver claims them in the
-- partner app (`features`: ac, heating, family, no_smoking, big_boot, child_seat); ops confirm them at the
-- car check (`features_confirmed`, always a subset of the claims). Customers only ever see confirmed ones.

-- AlterTable
ALTER TABLE "public"."vehicles" ADD COLUMN     "model" TEXT,
ADD COLUMN     "colour" TEXT,
ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "features_confirmed" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "public"."vehicles"
    ADD CONSTRAINT "vehicles_colour_check" CHECK ("colour" IS NULL OR "colour" IN ('white', 'black', 'silver', 'grey', 'red', 'maroon', 'blue', 'green', 'beige', 'gold', 'brown', 'yellow', 'orange'));

ALTER TABLE "public"."vehicles"
    ADD CONSTRAINT "vehicles_features_check" CHECK ("features" <@ ARRAY['ac', 'heating', 'family', 'no_smoking', 'big_boot', 'child_seat']::TEXT[] AND "features_confirmed" <@ "features");
