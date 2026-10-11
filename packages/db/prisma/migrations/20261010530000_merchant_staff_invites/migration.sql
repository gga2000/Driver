-- PRV-08 (Ali 2026-10-10): a new staff member joins a store only after accepting its invite. One row
-- per store and person (re-inviting resets it to pending). Ids, role, status and times only: the
-- number and the name stay in identity_vault. Additive only.

-- CreateTable
CREATE TABLE "public"."merchant_staff_invites" (
    "id" TEXT NOT NULL,
    "merchant_org_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "answered_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_staff_invites_person_id_status_idx" ON "public"."merchant_staff_invites"("person_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_staff_invites_merchant_org_id_person_id_key" ON "public"."merchant_staff_invites"("merchant_org_id", "person_id");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
