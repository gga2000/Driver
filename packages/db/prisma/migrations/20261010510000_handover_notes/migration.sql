-- Console › اليوم, the shift handover note (h5): the outgoing shift's few lines, and who has read them.
-- Staff ids, times and the staff-written note only. Additive only.

-- CreateTable
CREATE TABLE "public"."handover_notes" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handover_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."handover_acks" (
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handover_acks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handover_notes_city_id_created_at_idx" ON "public"."handover_notes"("city_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "handover_acks_note_id_person_id_key" ON "public"."handover_acks"("note_id", "person_id");

-- AddForeignKey
ALTER TABLE "public"."handover_acks" ADD CONSTRAINT "handover_acks_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."handover_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
