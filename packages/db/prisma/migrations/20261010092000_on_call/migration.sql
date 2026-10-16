-- Console E1 (CON-02, G0-9): the on-call roster (who is reached when an alert reaches nobody) and each
-- alert's ladder (rings, the on-call step reached, unanswered). Ids and times only (names stay in
-- identity_vault). Additive only.

-- CreateTable
CREATE TABLE "public"."on_call_shifts" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "desk" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "on_call_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."alert_ladders" (
    "id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "brief" JSONB NOT NULL DEFAULT '{}',
    "opened_at" TIMESTAMP(3) NOT NULL,
    "next_ring_at" TIMESTAMP(3) NOT NULL,
    "rings" INTEGER NOT NULL DEFAULT 0,
    "on_call_step" INTEGER NOT NULL DEFAULT 0,
    "unanswered" BOOLEAN NOT NULL DEFAULT false,
    "taken_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "steps" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_ladders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "on_call_shifts_city_id_desk_ends_at_idx" ON "public"."on_call_shifts"("city_id", "desk", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "alert_ladders_alert_id_key" ON "public"."alert_ladders"("alert_id");

-- CreateIndex
CREATE INDEX "alert_ladders_closed_at_next_ring_at_idx" ON "public"."alert_ladders"("closed_at", "next_ring_at");

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
