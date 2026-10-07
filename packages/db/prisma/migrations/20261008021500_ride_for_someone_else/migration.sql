-- Taxi/tuktuk step 4, ride ideas c9/s3 «لمنو المشوار؟»: a ride booked for someone else. Additive only.
--
-- The rider is a person (found by number, or created pseudonymously like a household invite) on a
-- `rider` participant; the name the booker gave them («ماما», «أم علي») lives here in the vault,
-- keyed by the participant id. Every read is a vault_access_logs row against the rider.

CREATE TABLE "identity_vault"."participant_identities" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "given_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "participant_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "participant_identities_participant_id_key" ON "identity_vault"."participant_identities"("participant_id");

CREATE INDEX "participant_identities_person_id_idx" ON "identity_vault"."participant_identities"("person_id");

ALTER TABLE "identity_vault"."participant_identities" ADD CONSTRAINT "participant_identities_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
