-- Console E1 (CON-12): the Today list. One row per problem (kind + subject), opened and closed from
-- domain events and worked by the desk. Ids and short facts only (names stay in identity_vault).
-- Additive only.

-- CreateTable
CREATE TABLE "public"."inbox_items" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "order_id" TEXT,
    "trip_id" TEXT,
    "facts" JSONB NOT NULL DEFAULT '{}',
    "opened_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "times" INTEGER NOT NULL DEFAULT 1,
    "assignee_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "snoozed_until" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "done_by_id" TEXT,
    "outcome" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbox_items_city_id_done_at_idx" ON "public"."inbox_items"("city_id", "done_at");

-- CreateIndex
CREATE INDEX "inbox_items_order_id_idx" ON "public"."inbox_items"("order_id");

-- CreateIndex
CREATE INDEX "inbox_items_trip_id_idx" ON "public"."inbox_items"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_items_kind_subject_id_key" ON "public"."inbox_items"("kind", "subject_id");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
