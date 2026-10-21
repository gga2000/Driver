-- Console › محرر الخريطة (Ali, 2026-10-20): the team edits restaurants' and landmarks' pins, names and
-- icons on one map; every change is kept with what it was before (so it can be undone), and fixes sent
-- from the apps wait in an inbox. Pins, names, a short note and person ids only; no personal data.
-- Additive only. A landmark taken off the maps keeps its row with "landmark_state" = 'hidden'.

-- CreateTable
CREATE TABLE "public"."map_edits" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary_ar" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "merged_id" TEXT,
    "actor_id" TEXT NOT NULL,
    "undone_at" TIMESTAMP(3),
    "undone_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "map_edits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "map_edits_target_kind_check" CHECK ("target_kind" IN ('landmark', 'restaurant')),
    CONSTRAINT "map_edits_action_check" CHECK ("action" IN ('add', 'edit', 'move', 'hide', 'show', 'merge'))
);

-- CreateTable
CREATE TABLE "public"."map_reports" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target_kind" TEXT,
    "target_id" TEXT,
    "pin" JSONB,
    "name_ar" TEXT,
    "note" TEXT,
    "reporter_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "decided_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "map_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "map_reports_source_check" CHECK ("source" IN ('driver', 'merchant', 'ops')),
    CONSTRAINT "map_reports_kind_check" CHECK ("kind" IN ('moved', 'new_place', 'wrong_name', 'closed')),
    CONSTRAINT "map_reports_target_kind_check" CHECK ("target_kind" IS NULL OR "target_kind" IN ('landmark', 'restaurant')),
    CONSTRAINT "map_reports_state_check" CHECK ("state" IN ('open', 'accepted', 'rejected'))
);

-- CreateIndex
CREATE INDEX "map_edits_city_id_created_at_idx" ON "public"."map_edits"("city_id", "created_at");
CREATE INDEX "map_edits_target_kind_target_id_created_at_idx" ON "public"."map_edits"("target_kind", "target_id", "created_at");
CREATE INDEX "map_reports_city_id_state_created_at_idx" ON "public"."map_reports"("city_id", "state", "created_at");
CREATE INDEX "map_reports_reporter_id_state_idx" ON "public"."map_reports"("reporter_id", "state");

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
