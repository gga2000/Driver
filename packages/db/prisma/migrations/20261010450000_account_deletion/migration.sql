-- W7 account deletion (docs/api/account-deletion.md): the code a customer confirms the deletion with,
-- and a deleted account's number kept as its peppered hash only (no person id) so the account-age caps
-- follow the number to a new account.
ALTER TYPE "OtpPurpose" ADD VALUE 'account_delete';

-- Deletion runs in two parts: the account is closed at once (deleted_at), then every module erases or
-- blurs its rows (erased_at once all are done; a job retries until then).
ALTER TABLE "public"."people" ADD COLUMN "erased_at" TIMESTAMP(3);
ALTER TABLE "public"."people" ADD CONSTRAINT "people_erased_after_deleted" CHECK ("erased_at" IS NULL OR "deleted_at" IS NOT NULL);
CREATE INDEX "people_deleted_not_erased_idx" ON "public"."people"("deleted_at") WHERE "deleted_at" IS NOT NULL AND "erased_at" IS NULL;

-- CreateTable
CREATE TABLE "identity_vault"."retired_phones" (
    "id" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "account_since" TIMESTAMP(3) NOT NULL,
    "retired_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retired_phones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retired_phones_phone_hash_idx" ON "identity_vault"."retired_phones"("phone_hash");

SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
