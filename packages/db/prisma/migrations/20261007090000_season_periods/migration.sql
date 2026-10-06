-- Seasons (customer joy J6, docs/superpowers/plans/2026-10-06-j6-seasons.md): quiet periods become typed
-- season periods. `kind` defaults to 'quiet' and every switch to off, so existing rows and J1a's
-- setQuietDays keep their meaning. Ramadan rows carry the Shia maghrib offset (minutes after sunset,
-- NULL = the default) and per-day iftar overrides ({"YYYY-MM-DD": {"sunni": "HH:MM", "shia": "HH:MM"}}).
-- Additive only.

ALTER TABLE "public"."quiet_periods"
    ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'quiet',
    ADD COLUMN "celebrations" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "sounds" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "promos" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "accent" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "home_card" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "home_card_ar" TEXT,
    ADD COLUMN "shia_offset_min" INTEGER,
    ADD COLUMN "iftar_overrides" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "public"."quiet_periods"
    ADD CONSTRAINT "quiet_periods_kind_check" CHECK ("kind" IN ('quiet', 'ramadan', 'eid', 'friday_special'));

CREATE INDEX "quiet_periods_kind_ends_on_idx" ON "public"."quiet_periods"("kind", "ends_on");

-- Supabase lock-down (no new table; re-run so the lock-down stays the last word of every migration).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
