-- Joy J7b (docs/superpowers/plans/2026-10-07-j7b-generosity.md). Additive only.
--
-- «عزيمة» (g1): an order can be a gift for its recipient participant, optionally with the prices kept off
-- the kitchen ticket and out of the courier's mouth (only when the sender paid from his wallet). The
-- card message never reaches the server (it travels in the sender's own WhatsApp/SMS heads-up).
--
-- Invite as a gift (g2): each person's invite code, and who invited whom, so the referral rule that the
-- ledger already has (decisions §1: 200 points per side after the friend's 2nd cash order ≥ 10,000)
-- learns the inviter from the closed order. Ids and codes only (names stay in the vault).

ALTER TABLE "public"."orders" ADD COLUMN     "gift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gift_hide_prices" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "public"."invite_codes" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."referrals" (
    "id" TEXT NOT NULL,
    "referee_id" TEXT NOT NULL,
    "referrer_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invite_codes_person_id_key" ON "public"."invite_codes"("person_id");

CREATE UNIQUE INDEX "invite_codes_code_key" ON "public"."invite_codes"("code");

CREATE UNIQUE INDEX "referrals_referee_id_key" ON "public"."referrals"("referee_id");

CREATE INDEX "referrals_referrer_id_claimed_at_idx" ON "public"."referrals"("referrer_id", "claimed_at");

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
