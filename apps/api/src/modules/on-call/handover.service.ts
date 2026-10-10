import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  HANDOVER_RULES,
  type Actor,
  type HandoverAckInput,
  type HandoverInput,
  type HandoverNote,
  type HandoverWriteInput,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { AuditLogService } from '../controls/index.js';
import { HANDOVER_REPOSITORY, type HandoverRecord, type HandoverRepository } from './handover.repository.js';

/**
 * The shift handover note on Console › اليوم (h5). The outgoing shift writes a few lines; the next
 * shift sees the newest one on Today until each person taps «وصلت», or until it is `showHours` old.
 * Writing is audited; a tap is a read receipt (the ack row itself).
 */
@Injectable()
export class HandoverService {
  constructor(
    @Inject(HANDOVER_REPOSITORY) private readonly repo: HandoverRepository,
    private readonly audits: AuditLogService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async latest(actor: Actor, input: z.output<typeof HandoverInput>): Promise<HandoverNote | null> {
    const since = new Date(this.clock.now().getTime() - HANDOVER_RULES.showHours * 3_600_000);
    const rec = await this.repo.latest(input.cityId, since);
    return rec ? view(rec, actor) : null;
  }

  async write(actor: Actor, input: z.output<typeof HandoverWriteInput>): Promise<HandoverNote> {
    const now = this.clock.now();
    const rec = await this.uow.run(async (tx) => {
      const added = await this.repo.add({ cityId: input.cityId, authorId: actor.personId, body: input.body }, now, tx);
      // The writer has read their own note.
      await this.repo.ack(added.id, actor.personId, now, tx);
      await this.audits.record(
        {
          cityId: input.cityId,
          actorId: actor.personId,
          action: 'handover.written',
          subjectKind: 'handover_note',
          subjectId: added.id,
          summaryAr: 'انكتبت ملاحظة تسليم الشفت',
          detail: { length: input.body.length },
        },
        tx,
      );
      return { ...added, ackedBy: [actor.personId] };
    });
    return view(rec, actor);
  }

  async ack(actor: Actor, input: z.output<typeof HandoverAckInput>): Promise<HandoverNote> {
    const rec = await this.uow.run(async (tx) => {
      const found = await this.repo.find(input.id, tx);
      if (!found) throw new DriverError('not_found');
      await this.repo.ack(found.id, actor.personId, this.clock.now(), tx);
      return (await this.repo.find(found.id, tx))!;
    });
    return view(rec, actor);
  }
}

function view(rec: HandoverRecord, actor: Actor): HandoverNote {
  return {
    id: rec.id,
    cityId: rec.cityId,
    authorId: rec.authorId,
    body: rec.body,
    createdAt: rec.createdAt,
    ackedByMe: rec.ackedBy.includes(actor.personId),
    acks: rec.ackedBy.length,
    mine: rec.authorId === actor.personId,
  };
}
