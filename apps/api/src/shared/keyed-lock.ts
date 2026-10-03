/**
 * In-process mutual exclusion per key: `run(key, fn)` waits for every earlier `fn` under the same
 * key to settle before starting. Serialises one instance's writers (and the in-memory twins, which
 * have no database lock); across instances the caller also takes a database lock inside its
 * transaction (e.g. `pg_advisory_xact_lock`). Keys are dropped once idle, so the map stays small.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.catch(() => undefined).then(fn);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
