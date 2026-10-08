-- Perf item 13: running balance of each driver money account, so the dispatch cap check
-- (`canOffer`, once per nearby driver per wave) reads one row instead of the driver's whole ledger
-- history. Only `driver:<id>` and `cash:<id>` accounts are kept: they are per driver, so the row
-- lock taken here never serialises postings of different drivers (a `platform` row would).
--
-- The ledger stays append-only and the source of truth. This table is a projection: an AFTER INSERT
-- trigger on `ledger_events` adds each line to it in the same transaction as the posting, whatever
-- code path wrote the line. The nightly close compares it with the full sum and repairs drift.
CREATE TABLE "public"."ledger_balances" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount_iqd" INTEGER NOT NULL,
    "events" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ledger_balances_account_id_key" ON "public"."ledger_balances"("account_id");

-- Which accounts are projected. Keep in step with `isProjectedAccount` in
-- apps/api/src/modules/ledger/repository.ts.
CREATE OR REPLACE FUNCTION "public"."ledger_balance_projected"(account TEXT)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT starts_with(account, 'driver:') OR starts_with(account, 'cash:')
$$;

CREATE OR REPLACE FUNCTION "public"."ledger_balances_apply"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "public"."ledger_balance_projected"(NEW.to_account) THEN
    INSERT INTO "public"."ledger_balances" ("id", "account_id", "amount_iqd", "events", "updated_at")
    VALUES (gen_random_uuid()::TEXT, NEW.to_account, NEW.amount_iqd, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("account_id") DO UPDATE
      SET "amount_iqd" = "ledger_balances"."amount_iqd" + EXCLUDED."amount_iqd",
          "events" = "ledger_balances"."events" + 1,
          "updated_at" = CURRENT_TIMESTAMP;
  END IF;
  IF "public"."ledger_balance_projected"(NEW.from_account) THEN
    INSERT INTO "public"."ledger_balances" ("id", "account_id", "amount_iqd", "events", "updated_at")
    VALUES (gen_random_uuid()::TEXT, NEW.from_account, -NEW.amount_iqd, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("account_id") DO UPDATE
      SET "amount_iqd" = "ledger_balances"."amount_iqd" + EXCLUDED."amount_iqd",
          "events" = "ledger_balances"."events" + 1,
          "updated_at" = CURRENT_TIMESTAMP;
  END IF;
  RETURN NULL;
END $$;

-- Backfill from the full history, then keep it current. The table lock makes the two atomic: no
-- posting can land between the backfill's read and the trigger's creation.
LOCK TABLE "public"."ledger_events" IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO "public"."ledger_balances" ("id", "account_id", "amount_iqd", "events", "updated_at")
SELECT gen_random_uuid()::TEXT, account, SUM(delta), COUNT(*), CURRENT_TIMESTAMP
FROM (
  SELECT "to_account" AS account, "amount_iqd" AS delta FROM "public"."ledger_events"
  WHERE "public"."ledger_balance_projected"("to_account")
  UNION ALL
  SELECT "from_account" AS account, -"amount_iqd" AS delta FROM "public"."ledger_events"
  WHERE "public"."ledger_balance_projected"("from_account")
) lines
GROUP BY account;

CREATE TRIGGER "ledger_balances_apply"
  AFTER INSERT ON "public"."ledger_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."ledger_balances_apply"();

SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
