-- The courier at the pass (UI/UX audit S-M4): the kitchen taps "سلّمته" when it hands the bag to the
-- courier at the counter. This column records when, so a second tap is a no-op and the order's history
-- shows the kitchen's side of the hand-over. Additive and nullable: no state or money changes with it.
ALTER TABLE "public"."orders" ADD COLUMN "handed_over_at" TIMESTAMP(3);
