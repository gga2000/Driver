-- "خبرني لمن ينفتح" (customer audit C-03): people who asked to be told when a coming-soon service
-- (grocery, خطوط, parcels) opens, one row per person and service, with the zone of their deliver-to
-- place. The Console reads the counts per service and zone. Additive only; the person is referenced
-- by id (no foreign key into identity).

CREATE TABLE "public"."launch_interests" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "zone_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "launch_interests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "launch_interests_service_zone_key_idx" ON "public"."launch_interests"("service", "zone_key");

CREATE UNIQUE INDEX "launch_interests_person_id_service_key" ON "public"."launch_interests"("person_id", "service");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
