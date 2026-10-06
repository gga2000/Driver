-- Quiet days (customer joy J1a, docs/specs/2026-10-05-customer-joy.md): mourning days ops set in the
-- Console. While one is on, the apps play no celebrations or moment sounds and the notify engine sends
-- no offers. Days are Baghdad calendar dates (YYYY-MM-DD, inclusive). Additive only.

CREATE TABLE "public"."quiet_periods" (
    "id" TEXT NOT NULL,
    "city_id" TEXT,
    "starts_on" TEXT NOT NULL,
    "ends_on" TEXT NOT NULL,
    "label_ar" TEXT NOT NULL,
    "set_by_id" TEXT NOT NULL,
    "cleared_at" TIMESTAMP(3),
    "cleared_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiet_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quiet_periods_ends_on_idx" ON "public"."quiet_periods"("ends_on");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
