/**
 * Break glass for the staff authenticator (docs/api/staff-totp.md, «Break glass»). When no admin can
 * reset a staff member's authenticator in the Console (the only admin lost his phone and his recovery
 * codes), someone with Fly access runs this once on the API machine:
 *
 *   fly ssh console --config deploy/fly/api.toml -C "node dist/staff-totp-break-glass.js --phone 07XXXXXXXXX --operator 'Name' --reason 'why'"
 *       → looks only: whether the number is a person and has an authenticator set up
 *   … the same with --yes
 *       → clears it: the set-up is deleted, every session ends, the person gets the reset notice, and
 *         the Console audit trail gets a row with the operator and the reason
 *
 * It uses the machine's own DATABASE_URL and PHONE_HASH_PEPPER and prints nothing secret (the number
 * masked, no codes, no keys). The person sets the app up again at his next sign-in.
 */
import { PrismaControlsRepository } from './modules/controls/index.js';
import { newId, PrismaEventsRepository, type StoredEvent } from './modules/events/index.js';
import { BREAK_GLASS_ACTOR, staffTotpBreakGlass } from './modules/identity/index.js';
import { PrismaService } from './shared/db/prisma.service.js';
import { UnitOfWork, type Tx } from './shared/db/unit-of-work.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const phone = arg('phone');
  const operator = arg('operator') ?? '';
  const reason = arg('reason') ?? '';
  const apply = process.argv.includes('--yes');
  if (!phone) {
    console.error('usage: node dist/staff-totp-break-glass.js --phone 07XXXXXXXXX --operator <who> --reason <why> [--yes]');
    return 2;
  }
  if (!process.env['DATABASE_URL']) {
    console.error('DATABASE_URL is not set: run this on the API machine (fly ssh console)');
    return 2;
  }
  const prisma = new PrismaService();
  const uow = new UnitOfWork(prisma);
  const eventRows = new PrismaEventsRepository(prisma);
  const audits = new PrismaControlsRepository(prisma);
  try {
    const out = await staffTotpBreakGlass(
      {
        prisma,
        uow,
        // Straight to the event log and its outbox; the running API's publisher delivers them.
        events: {
          async emit(tx, event, aggregate) {
            const recordedAt = new Date();
            const stored: StoredEvent = {
              id: newId('ev', recordedAt),
              type: event.type,
              actorId: event.actorId,
              occurredAt: event.occurredAt,
              recordedAt,
              aggregate: aggregate.name,
              aggregateId: aggregate.id,
              payload: event.payload ?? {},
              skewMs: 0,
              flagged: false,
              quarantined: false,
            };
            await eventRows.insert(stored, tx);
            return { ...event, id: stored.id, recordedAt };
          },
        },
        audit: (row, tx: Tx) =>
          audits.addAudit({ cityId: null, actorId: BREAK_GLASS_ACTOR, action: 'staff.totp_reset', subjectKind: 'person', subjectId: row.personId, summaryAr: row.summaryAr, detail: row.detail, at: row.at }, tx),
      },
      { phone, operator, reason, apply },
    );
    if (!out.found) {
      console.log(`${out.phoneMasked}: no person with this number. Nothing changed.`);
      return 1;
    }
    if (!out.applied) {
      console.log(`${out.phoneMasked}: person ${out.personId}, authenticator ${out.hadApp ? 'set up' : 'not set up'}. Dry run: add --yes to clear it.`);
      return 0;
    }
    console.log(`${out.phoneMasked}: authenticator ${out.hadApp ? 'cleared' : 'was not set up'}, ${out.ended} session(s) ended, audit row written. They set it up again at the next sign-in.`);
    return 0;
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`break glass failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
