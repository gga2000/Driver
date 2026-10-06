-- Refresh-token reuse detection: each session remembers the refresh token its last rotation retired.
-- Presenting that token again means two holders exist (theft), so the server revokes the session.
-- Additive only (no new tables); NULL = no rotation yet.

ALTER TABLE "public"."sessions" ADD COLUMN "previous_refresh_token_hash" TEXT;

CREATE UNIQUE INDEX "sessions_previous_refresh_token_hash_key" ON "public"."sessions"("previous_refresh_token_hash");
