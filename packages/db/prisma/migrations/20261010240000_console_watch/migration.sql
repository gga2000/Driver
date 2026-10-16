-- Console E1 step 3: the Console watching itself. Every open staff screen's heartbeat (per tab, with the
-- state of its live updates) and the watch alerts (nobody watching, live updates down). Ids and times
-- only. Additive only.

-- CreateTable
CREATE TABLE "public"."console_presence" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "tab_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "live" TEXT NOT NULL,
    "live_since" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "console_presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."console_watch_alerts" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "open_key" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "paged" INTEGER NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "console_watch_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "console_presence_city_id_last_seen_at_idx" ON "public"."console_presence"("city_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "console_presence_city_id_tab_id_key" ON "public"."console_presence"("city_id", "tab_id");

-- CreateIndex
CREATE UNIQUE INDEX "console_watch_alerts_open_key_key" ON "public"."console_watch_alerts"("open_key");

-- CreateIndex
CREATE INDEX "console_watch_alerts_city_id_opened_at_idx" ON "public"."console_watch_alerts"("city_id", "opened_at");


-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
