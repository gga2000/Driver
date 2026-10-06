-- Menu photo service (maps program k3, spec §5.7): a restaurant asks for its dishes to be photographed;
-- field ops take the request, set a visit and shoot each dish through the Partner app; the owner accepts
-- (the photo becomes the dish's photo) or rejects each one in the Merchant app. `menu_photo_shots` holds
-- one photo per dish per request (an upload id in the blob store). No money moves. Additive only.

CREATE TABLE "public"."menu_photo_requests" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "note" TEXT,
    "item_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" TEXT NOT NULL DEFAULT 'requested',
    "assigned_ops_id" TEXT,
    "scheduled_for" TIMESTAMP(3),
    "shot_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_photo_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."menu_photo_shots" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'proposed',
    "taken_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_photo_shots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "menu_photo_requests_org_id_created_at_idx" ON "public"."menu_photo_requests"("org_id", "created_at");

CREATE INDEX "menu_photo_requests_city_id_state_idx" ON "public"."menu_photo_requests"("city_id", "state");

CREATE UNIQUE INDEX "menu_photo_shots_request_id_item_id_key" ON "public"."menu_photo_shots"("request_id", "item_id");

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
