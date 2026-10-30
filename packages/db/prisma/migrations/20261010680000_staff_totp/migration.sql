-- Staff sign-in's second step (docs/api/staff-totp.md): admin and finance confirm an authenticator app
-- code after the SMS code. The encrypted secret, the last step used, the wrong-try lock and the salted
-- recovery-code hashes live in identity_vault; a session only records when it passed the step.
-- Additive only.

-- AlterTable
ALTER TABLE "public"."sessions" ADD COLUMN     "second_step_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "identity_vault"."staff_totp" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "last_step" INTEGER,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "recovery_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_totp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_totp_person_id_key" ON "identity_vault"."staff_totp"("person_id");

-- AddForeignKey
ALTER TABLE "identity_vault"."staff_totp" ADD CONSTRAINT "staff_totp_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
