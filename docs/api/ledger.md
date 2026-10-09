# Ledger

The ledger (`apps/api/src/modules/ledger`) is the append-only money and points book: every fact is a
balanced posting group in `ledger_events`, corrections are new rows, and no row is ever updated or
deleted (a database trigger rejects it). Money rules live in `postings.ts`; this page covers how
balances are read.

## Running driver balance (perf item 13, 2026-10-10)

**Why.** The cap check `CapsService.canOffer` runs for every nearby driver in every dispatch wave and
needs two balances per driver: earnings (`driver:<id>`) and cash held (`cash:<id>`). Before this,
`LedgerService.balance` read the account's whole history and summed it, so each wave got slower with
every shift a driver worked.

**What.** Table `ledger_balances` (migration `20261010270000_driver_running_balance`) holds one row per
driver account: `account_id`, `amount_iqd` (the same sum the full history gives) and `events` (lines
touching the account).

- **Kept by the database.** An `AFTER INSERT` trigger on `ledger_events` (`ledger_balances_apply`)
  adds each line to its `driver:` / `cash:` side(s) with `INSERT … ON CONFLICT DO UPDATE`, in the same
  transaction as the posting. A rolled-back posting rolls its balance back; a replayed group writes no
  line, so it changes nothing; any code path that inserts a line (seed, script, old code during a
  deploy) is counted.
- **Only per-driver accounts.** `platform`, `bank`, customers and merchants keep the full-sum read.
  Each row is locked only by postings for that one driver, so postings of different drivers never wait
  on each other (a `platform` row would serialise every posting). The rule lives twice and must stay in
  step: `isProjectedAccount` in `repository.ts` and `ledger_balance_projected()` in the migration.
- **Reads.** `LedgerService.balance(account)` with no `before` date reads the row for a driver account
  (no row = 0 and 0 events). With a `before` date, or for any other account, it sums the history as
  before. `LedgerService.fullBalance` always sums the history. Callers did not change, including
  `offer.orchestrator.ts`.
- **Backfill.** The migration fills the table from the full history under a `SHARE ROW EXCLUSIVE` lock
  on `ledger_events`, then creates the trigger in the same migration, so no posting can fall between
  the two.
- **Nightly check.** The 02:00 close (`NightlyJob.run`) calls `LedgerService.reconcileRunningBalances`
  before the per-driver report. It sums every driver account from one read of the book and compares it
  with the table. If an account differs, it repairs that account
  (`PrismaLedgerBalanceStore.repair`): it takes the account's row lock first, then sums on a fresh
  snapshot, then sets the row. A posting in flight therefore either finishes before the sum and is
  counted, or waits and adds on top, so it is never lost or counted twice. Each account it really
  changed is logged as an error and opened as a `ledger_balance_drift` incident. If the check itself
  fails, it opens `ledger_balance_check_failed` and the close goes on.
- **Locks (for the reviewer).** A posting now takes a row lock on the driver's balance row(s) until it
  commits, in line order. Two postings for the same driver that touch both of his accounts in
  opposite orders at the same moment could deadlock; Postgres then aborts one of them and nothing is
  half-written. This needs two such postings for one driver within the same instant, which should be
  rare (not yet audited across every caller). The integration test runs 16 concurrent postings on
  one driver, all in the same line order.
- **Unchanged:** amounts, payees, posting groups, control totals, `ledger_events` rows and their
  append-only guard. `ledger_balances` is a projection, never the source of truth; the nightly check
  repairs it from the ledger, not the other way round.

**Without a database** (studio, simulator, unit tests), `InMemoryLedgerRepository` keeps the same
running balances in memory as it appends.

**Proof.**
- `running-balance.test.ts`: random books with replays equal the full sum; driver reads never read the
  history; drift is repaired and reported; the nightly close opens the incident.
- `running-balance.integration.test.ts` (Postgres): random postings, a replay, a rollback and 16
  concurrent postings on one driver all equal the full sum; the migration's backfill query gives the
  trigger's numbers; a line inserted with the trigger off is caught and repaired.
- `pnpm sim --orders 2000 --seed 1 --ci`.
