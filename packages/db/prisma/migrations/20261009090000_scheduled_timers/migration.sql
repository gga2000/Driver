-- Durable timers (launch plan W4: SCALE-08, SCALE-09, OPS-03, CRIT1-08). Additive only; nothing writes
-- these rows yet: the transaction-aware `queue.add` lands in the split window (plan 3.3) and the sweeper
-- stays off until `TIMERS_SWEEPER=on`.
--
-- Every delayed job becomes a row written in the caller's transaction. BullMQ only fires it sooner; a
-- sweeper claims due rows with a lease (`claimed_until`) under `FOR UPDATE SKIP LOCKED`, retries with
-- backoff up to `max_attempts`, and marks them fired. Losing Redis then only delays a timer. `data` holds
-- ids only, never personal data. Fired rows are pruned after 7 days, failed rows after 30.

-- CreateEnum
CREATE TYPE "public"."TimerStatus" AS ENUM ('pending', 'fired', 'failed');

-- CreateTable
CREATE TABLE "public"."scheduled_timers" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "job_id" TEXT,
    "data" JSONB NOT NULL,
    "status" "public"."TimerStatus" NOT NULL DEFAULT 'pending',
    "due_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "claimed_until" TIMESTAMP(3),
    "claimed_by" TEXT,
    "fired_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_timers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_timers_status_due_at_idx" ON "public"."scheduled_timers"("status", "due_at");

-- CreateIndex
CREATE INDEX "scheduled_timers_status_fired_at_idx" ON "public"."scheduled_timers"("status", "fired_at");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_timers_queue_job_id_key" ON "public"."scheduled_timers"("queue", "job_id");

ALTER TABLE "public"."scheduled_timers"
    ADD CONSTRAINT "scheduled_timers_attempts_check" CHECK ("attempts" >= 0 AND "max_attempts" >= 1),
    ADD CONSTRAINT "scheduled_timers_fired_check" CHECK (("status" = 'fired') = ("fired_at" IS NOT NULL));

SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
