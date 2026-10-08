-- Gift orders (joy g1 «عزيمة», G0-10): the number the sender typed for the person receiving the gift,
-- so the one «الدليفري يوصلك» SMS reaches them when the courier is almost there. Additive only.
--
-- Keyed by the recipient participant. The number lives only here in the vault; notify reads it once
-- (a vault_access_logs row against the sender) and only within 24 h of the order.

CREATE TABLE "identity_vault"."recipient_contacts" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "given_by_id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipient_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recipient_contacts_participant_id_key" ON "identity_vault"."recipient_contacts"("participant_id");

CREATE INDEX "recipient_contacts_created_at_idx" ON "identity_vault"."recipient_contacts"("created_at");

-- At most 3 gift SMS to one number a day: the earlier rows for the same number are counted.
CREATE INDEX "recipient_contacts_phone_e164_created_at_idx" ON "identity_vault"."recipient_contacts"("phone_e164", "created_at");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
