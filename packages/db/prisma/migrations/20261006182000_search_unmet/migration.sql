-- Unmet searches (customer joy h4, discovery D-13): a search that found nothing, kept only when the
-- customer said «إي گولولهم». The Console lists the most asked-for words so ops know which kitchen or
-- dish to bring next. Anonymous: the folded term, as typed, the deliver-to zone and whether the
-- person was signed in; no person id. Additive only.

CREATE TABLE "public"."search_unmet" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "typed" TEXT NOT NULL,
    "zone_key" TEXT,
    "signed_in" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_unmet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "search_unmet_city_id_created_at_idx" ON "public"."search_unmet"("city_id", "created_at");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
