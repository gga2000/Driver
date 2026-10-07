-- Taxi/tuktuk safety (ride step 3, Ali's yes on s1 and s7). Additive only.
--
-- s1 «رمز المشوار»: a ride placed for the night carries the 4 digits the rider tells the driver before
-- getting in (`orders.start_code`, null on day rides and older rows). Each pickup counts the wrong codes
-- typed on it, and the moment they reach START_CODE_RULES.wrongAlertAt ops get a row on the Console
-- safety strip (`stops.start_code_alert_at`, set once). The code itself is only on the order.
--
-- s7 «نسيت غرض»: the customer reopens a completed ride's chat with the driver; it stays open until the
-- ride's end + 24 h (`chat_threads.lost_item_until`, null when never reopened).

-- AlterTable
ALTER TABLE "public"."orders" ADD COLUMN "start_code" TEXT;

-- AlterTable
ALTER TABLE "public"."stops" ADD COLUMN "start_code_wrong" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "start_code_alert_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."chat_threads" ADD COLUMN "lost_item_until" TIMESTAMP(3),
ADD COLUMN "lost_item_asked_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "stops_start_code_alert_at_idx" ON "public"."stops"("start_code_alert_at");

-- CreateIndex
CREATE INDEX "chat_threads_lost_item_until_idx" ON "public"."chat_threads"("lost_item_until");

ALTER TABLE "public"."orders"
    ADD CONSTRAINT "orders_start_code_check" CHECK ("start_code" IS NULL OR "start_code" ~ '^[0-9]{4}$');
