import type { PartnerBookedJob, PartnerBookedJobs } from '@driver/contracts';

/**
 * «مشاوير باچر» (edge-case review #28) on the phone: the pure rules behind the booked-rides screen and
 * its home card. The server decides everything; these only choose what to show.
 */

/** «طالع هسة» shows from the reminder (T−60) until T−30, when the ride starts by itself or goes to someone else. */
export function canStart(job: Pick<PartnerBookedJob, 'state' | 'startFrom' | 'showBy'>, now: Date): boolean {
  return job.state === 'confirmed' && now.getTime() >= job.startFrom.getTime() && now.getTime() < job.showBy.getTime();
}

/** An open job he may still take (the list can be a minute old: past its deadline it is gone). */
export function stillOpen(job: Pick<PartnerBookedJob, 'state' | 'confirmBy'>, now: Date): boolean {
  return job.state === 'open' && now.getTime() < job.confirmBy.getTime();
}

export type BookedHome = { kind: 'mine'; at: Date } | { kind: 'open'; n: number } | null;

/** The home card: his next confirmed ride first, else how many wait for a driver; nothing when none. */
export function bookedHome(jobs: PartnerBookedJobs | undefined, now: Date): BookedHome {
  if (!jobs) return null;
  const mine = jobs.mine.map((j) => j.scheduledFor).sort((a, b) => a.getTime() - b.getTime())[0];
  if (mine) return { kind: 'mine', at: mine };
  const n = jobs.open.filter((j) => stillOpen(j, now)).length;
  return n > 0 ? { kind: 'open', n } : null;
}
