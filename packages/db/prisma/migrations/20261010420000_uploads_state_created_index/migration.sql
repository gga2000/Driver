-- SEC-24: the sweep of upload tickets never uploaded reads pending rows oldest first.
CREATE INDEX "uploads_state_created_at_idx" ON "public"."uploads"("state", "created_at");
