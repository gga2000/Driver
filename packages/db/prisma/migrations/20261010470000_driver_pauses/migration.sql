-- r6 (Ali, 2026-10-08): staff can pause a courier or driver while a safety report is looked into. One
-- open row (lifted_at null) per person blocks going online until a person lifts it. Ids, times and
-- short staff notes only. Additive only.

-- CreateTable
CREATE TABLE "public"."driver_pauses" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ticket_id" TEXT,
    "note" TEXT NOT NULL,
    "paused_at" TIMESTAMP(3) NOT NULL,
    "paused_by_id" TEXT NOT NULL,
    "lifted_at" TIMESTAMP(3),
    "lifted_by_id" TEXT,
    "lift_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_pauses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_pauses_person_id_lifted_at_idx" ON "public"."driver_pauses"("person_id", "lifted_at");

-- At most one open pause per person: two staff pausing at once can't leave a second row that one lift
-- would miss (the service treats the losing insert as "already paused").
CREATE UNIQUE INDEX "driver_pauses_one_open_per_person" ON "public"."driver_pauses"("person_id") WHERE "lifted_at" IS NULL;

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
