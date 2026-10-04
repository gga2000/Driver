'use client';

import { consoleItemKey, orderTicketNumber, type ConsoleNames, type ConsoleNamesInput, type ConsolePersonName, type VehicleClass } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { vehicleLabel } from './labels';
import { useSignedIn } from './session';
import { useTRPCClient } from './trpc';

/**
 * K-01: people, merchants and dishes by name instead of by id. Components ask for the ids they show;
 * the store batches every ask made in the same moment into one `console.names` call (the API logs
 * each vault read against the signed-in staff member), keeps answers for ten minutes and re-asks
 * after a failure. Until a name arrives — or when there is none — the id is shown, so nothing
 * disappears.
 */

const TTL_MS = 10 * 60_000;
const RETRY_MS = 30_000;
const BATCH_WAIT_MS = 25;
/** The API's per-call cap (`CONSOLE_NAMES_MAX`). */
const BATCH = 200;

export type OrgName = ConsoleNames['orgs'][string];
export type ItemName = ConsoleNames['items'][string];
interface Entry<T> {
  value: T | null;
  until: number;
}
type Fetcher = (input: ConsoleNamesInput) => Promise<ConsoleNames>;

export interface NamesAsk {
  people?: ReadonlyArray<string | null | undefined>;
  orgs?: ReadonlyArray<string | null | undefined>;
  items?: ReadonlyArray<{ orgId: string | null | undefined; itemId: string | null | undefined }>;
}

/** `system`, `system:notify`, `system:demo`…: the platform itself, never a vault read. */
export function isSystemActor(id: string): boolean {
  return id === 'system' || id.startsWith('system:');
}

export class NameStore {
  private readonly people = new Map<string, Entry<ConsolePersonName>>();
  private readonly orgs = new Map<string, Entry<OrgName>>();
  private readonly items = new Map<string, Entry<ItemName>>();
  private readonly wanted = { people: new Set<string>(), orgs: new Set<string>(), items: new Map<string, { orgId: string; itemId: string }>() };
  private readonly inflight = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;

  constructor(
    private readonly fetcher: Fetcher,
    private readonly now: () => number = () => Date.now(),
  ) {}

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  readonly snapshot = (): number => this.version;

  /** Undefined while unknown to the store (not asked or still loading); null when the API has no name. */
  person(id: string): ConsolePersonName | null | undefined {
    return this.fresh(this.people.get(id));
  }
  org(id: string): OrgName | null | undefined {
    return this.fresh(this.orgs.get(id));
  }
  item(orgId: string, itemId: string): ItemName | null | undefined {
    return this.fresh(this.items.get(consoleItemKey(orgId, itemId)));
  }

  /** Queues what is missing or stale; one call goes out shortly after for everything queued. */
  ask(ask: NamesAsk): void {
    const now = this.now();
    let queued = false;
    for (const id of ask.people ?? []) {
      if (!id || isSystemActor(id) || this.known(this.people.get(id), now) || this.inflight.has(`p:${id}`)) continue;
      this.wanted.people.add(id);
      queued = true;
    }
    for (const id of ask.orgs ?? []) {
      if (!id || this.known(this.orgs.get(id), now) || this.inflight.has(`o:${id}`)) continue;
      this.wanted.orgs.add(id);
      queued = true;
    }
    for (const it of ask.items ?? []) {
      if (!it.orgId || !it.itemId) continue;
      const key = consoleItemKey(it.orgId, it.itemId);
      if (this.known(this.items.get(key), now) || this.inflight.has(`i:${key}`)) continue;
      this.wanted.items.set(key, { orgId: it.orgId, itemId: it.itemId });
      queued = true;
    }
    if (queued && !this.timer) this.timer = setTimeout(() => void this.flush(), BATCH_WAIT_MS);
  }

  /** Signing out forgets every name. */
  clear(): void {
    this.people.clear();
    this.orgs.clear();
    this.items.clear();
    this.bump();
  }

  /** Sends everything queued, at most `BATCH` of each kind per call. Exposed for tests. */
  async flush(): Promise<void> {
    this.timer = null;
    const people = [...this.wanted.people];
    const orgs = [...this.wanted.orgs];
    const items = [...this.wanted.items.entries()];
    this.wanted.people.clear();
    this.wanted.orgs.clear();
    this.wanted.items.clear();
    const calls: Promise<void>[] = [];
    for (let i = 0; i < Math.max(people.length, orgs.length, items.length); i += BATCH) {
      calls.push(this.fetchOne(people.slice(i, i + BATCH), orgs.slice(i, i + BATCH), items.slice(i, i + BATCH)));
    }
    await Promise.all(calls);
  }

  private async fetchOne(people: string[], orgs: string[], items: Array<[string, { orgId: string; itemId: string }]>): Promise<void> {
    if (people.length + orgs.length + items.length === 0) return;
    const keys = [...people.map((id) => `p:${id}`), ...orgs.map((id) => `o:${id}`), ...items.map(([k]) => `i:${k}`)];
    for (const k of keys) this.inflight.add(k);
    let res: ConsoleNames | null = null;
    try {
      res = await this.fetcher({ personIds: people, orgIds: orgs, items: items.map(([, v]) => v) });
    } catch {
      res = null;
    }
    const now = this.now();
    // A failed call shows ids for a while and asks again later; unknown ids are remembered as "no name".
    const until = now + (res ? TTL_MS : RETRY_MS);
    for (const id of people) this.people.set(id, { value: res?.people[id] ?? null, until });
    for (const id of orgs) this.orgs.set(id, { value: res?.orgs[id] ?? null, until });
    for (const [key] of items) this.items.set(key, { value: res?.items[key] ?? null, until });
    for (const k of keys) this.inflight.delete(k);
    this.bump();
  }

  private fresh<T>(e: Entry<T> | undefined): T | null | undefined {
    return e ? e.value : undefined;
  }
  private known<T>(e: Entry<T> | undefined, now: number): boolean {
    return e !== undefined && e.until > now;
  }
  private bump(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }
}

const stores = new WeakMap<object, NameStore>();

function storeFor(client: ReturnType<typeof useTRPCClient>): NameStore {
  let s = stores.get(client);
  if (!s) {
    s = new NameStore((input) => client.console.names.query(input));
    stores.set(client, s);
  }
  return s;
}

/**
 * Asks for the names a component shows and re-renders when they arrive. Read them with
 * `store.person(id)`, `store.org(id)`, `store.item(orgId, itemId)` or the label helpers below.
 */
export function useNames(ask: NamesAsk): NameStore {
  const client = useTRPCClient();
  const signedIn = useSignedIn();
  const store = storeFor(client);
  const key = useMemo(
    () =>
      JSON.stringify([
        [...new Set((ask.people ?? []).filter(Boolean))].sort(),
        [...new Set((ask.orgs ?? []).filter(Boolean))].sort(),
        (ask.items ?? []).map((i) => `${i.orgId}:${i.itemId}`).sort(),
      ]),
    [ask.people, ask.orgs, ask.items],
  );
  useEffect(() => {
    if (signedIn) store.ask(ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the content of `ask`
  }, [store, key, signedIn]);
  useEffect(() => {
    if (!signedIn) store.clear();
  }, [store, signedIn]);
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return store;
}

// ───────────────────────── labels (pure) ─────────────────────────

/**
 * The words for a person: "حيدر ك." (customers, staff), "حيدر ك. · تكتك · واسط 45671" (drivers, when
 * `vehicle` is asked for: the live vehicle class wins over the registry's), "حساب محذوف" for a
 * deleted account, the platform for `system` actors; null when there is no name (show the id).
 */
export function personText(id: string, p: ConsolePersonName | null | undefined, opts: { vehicle?: boolean; vehicleClass?: VehicleClass | null } = {}): string | null {
  if (isSystemActor(id)) return t('console.actor_system');
  if (!p) return null;
  if (p.deleted) return t('console.person_deleted');
  if (!p.displayName) return null;
  if (!opts.vehicle) return p.displayName;
  const cls = opts.vehicleClass ?? p.vehicleClass;
  return [p.displayName, cls ? vehicleLabel(cls) : null, p.plate].filter(Boolean).join(' · ');
}

/**
 * "#1284": the order number the kitchen, the courier and the customer all say. Wrapped in a
 * left-to-right isolate so the "#" stays in front of the digits inside Arabic text ("طلب #1284"),
 * where the bidi rules would otherwise move it behind them.
 */
export function orderLabel(orderId: string): string {
  return `⁦#${orderTicketNumber(orderId)}⁩`;
}

const PERSON_ACCOUNTS = new Set(['cash', 'driver', 'customer', 'points']);
const ORG_ACCOUNTS = new Set(['merchant_cash', 'merchant', 'household']);
const FIXED_ACCOUNTS = new Set(['bank', 'platform', 'rounding']);

/**
 * Ledger account (contracts `AccountId`) → who it is: "cash:p_7" / "driver:p_7" / "customer:p_9" →
 * that person, "merchant_cash:org_7" → the restaurant, "bank" / "platform" / "rounding" → fixed
 * words. Null for anything else (shown as written).
 */
export function accountRef(account: string): { kind: 'person' | 'org'; id: string } | { label: string } | null {
  const i = account.indexOf(':');
  const kind = i > 0 ? account.slice(0, i) : account;
  const id = i > 0 ? account.slice(i + 1) : '';
  if (id && PERSON_ACCOUNTS.has(kind)) return { kind: 'person', id };
  if (id && ORG_ACCOUNTS.has(kind)) return { kind: 'org', id };
  if (!id && FIXED_ACCOUNTS.has(kind)) return { label: t(`console.account_${kind}` as 'console.account_bank') };
  return null;
}
