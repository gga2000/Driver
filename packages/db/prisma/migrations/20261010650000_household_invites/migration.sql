-- SEC-06: household invites wait for the invitee's yes. One row per household and person (the latest
-- invite), ids only: the number's hint is read from identity_vault, logged, when the payer looks.
-- Additive only.

-- CreateTable
CREATE TABLE "public"."household_invites" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "spending_limit_iqd" INTEGER,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "invited_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_invites_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "household_invites_role_check" CHECK ("role" IN ('orderer', 'member')),
    CONSTRAINT "household_invites_state_check" CHECK ("state" IN ('pending', 'accepted', 'declined', 'cancelled'))
);

-- CreateIndex
CREATE INDEX "household_invites_person_id_state_idx" ON "public"."household_invites"("person_id", "state");

-- CreateIndex
CREATE INDEX "household_invites_org_id_invited_at_idx" ON "public"."household_invites"("org_id", "invited_at");

-- CreateIndex
CREATE UNIQUE INDEX "household_invites_org_id_person_id_key" ON "public"."household_invites"("org_id", "person_id");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
