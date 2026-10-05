import { POSITION_RULES } from '@driver/contracts';

export type SuspicionReason = 'mocked' | 'jump';

/**
 * Counts suspicious fixes per driver per local day and says when support should look: a fake-GPS fix at
 * once, jumps from the `jumpsBeforeFlag`-th. Each (driver, day, reason) flags once. In memory, per API
 * instance: the incident's source key keeps support from opening two tickets.
 */
export class SuspicionCounter {
  private readonly counts = new Map<string, number>();
  private day = '';

  constructor(private readonly rules: typeof POSITION_RULES = POSITION_RULES) {}

  /** True exactly when this note reaches the threshold for (driver, day, reason). */
  note(driverId: string, reason: SuspicionReason, day: string): boolean {
    if (day !== this.day) {
      this.counts.clear();
      this.day = day;
    }
    const key = `${driverId}|${reason}`;
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n === (reason === 'mocked' ? 1 : this.rules.jumpsBeforeFlag);
  }
}
