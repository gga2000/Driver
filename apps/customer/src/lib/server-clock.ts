/**
 * The API's clock, learned from the `Date` header of each answer (THIN-10). A cheap phone with no network
 * time can be minutes off; what must not run early by the phone's clock (the iftar countdown) reads
 * `serverClock.now()` instead. Until an answer has been seen, or when the header can't be read (a
 * cross-origin web page that isn't allowed to see it), it is the phone's own clock.
 */

/** Below this the phone is right enough: the header has one-second steps and a trip takes a moment. */
export const CLOCK_TRUST_MS = 2_000;

export class ServerClock {
  private offset = 0;
  /** Round trip of the sample the offset came from: a quicker one replaces it, a slower one doesn't. */
  private bestRttMs = Number.POSITIVE_INFINITY;
  private seenAt = 0;

  /**
   * One answer: its `Date` header and when the request left and the answer came back (phone clock).
   * The header is cut to the second, so the server's moment is taken half a second in.
   */
  note(dateHeader: string | null | undefined, sentAt: number, receivedAt: number): void {
    if (!dateHeader) return;
    const server = Date.parse(dateHeader);
    if (Number.isNaN(server)) return;
    const rtt = Math.max(0, receivedAt - sentAt);
    // A sample older than ten minutes no longer counts as best: the phone's clock may have been fixed since.
    if (rtt > this.bestRttMs && receivedAt - this.seenAt < 10 * 60_000) return;
    this.bestRttMs = rtt;
    this.seenAt = receivedAt;
    this.offset = server + 500 - (sentAt + rtt / 2);
  }

  /** How far the phone is behind the server (negative: ahead); 0 while within `CLOCK_TRUST_MS`. */
  offsetMs(): number {
    return Math.abs(this.offset) < CLOCK_TRUST_MS ? 0 : this.offset;
  }

  /** The server's "now" for a phone-clock instant. */
  now(phoneMs: number = Date.now()): Date {
    return new Date(phoneMs + this.offsetMs());
  }
}

export const serverClock = new ServerClock();

/** A fetch that tells `clock` the time of every answer it gets. */
export function withServerClock(fetchImpl: typeof fetch, clock: ServerClock = serverClock): typeof fetch {
  return async (input, init) => {
    const sentAt = Date.now();
    const res = await fetchImpl(input, init);
    clock.note(res.headers?.get?.('date'), sentAt, Date.now());
    return res;
  };
}
