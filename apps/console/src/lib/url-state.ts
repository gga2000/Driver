'use client';

import { useEffect, useRef } from 'react';

/** A page's filters as plain link values (`''` means "not set"). */
export type LinkParams = Record<string, string>;
export type LinkAllowed = Partial<Record<string, readonly string[]>>;

/** The query string for `values`: only what differs from the defaults, so a plain page keeps a plain link. Other params are kept. */
export function writeParams(search: string, values: LinkParams, defaults: LinkParams): string {
  const p = new URLSearchParams(search);
  for (const [k, v] of Object.entries(values)) {
    if (v === '' || v === defaults[k]) p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** What a link asks for: only the page's own keys, and for listed keys only values the page knows. */
export function readParams(search: string, defaults: LinkParams, allowed: LinkAllowed = {}): LinkParams {
  const p = new URLSearchParams(search);
  const out: LinkParams = {};
  for (const k of Object.keys(defaults)) {
    const v = p.get(k);
    if (v === null || v === '' || v.length > 80) continue;
    const ok = allowed[k];
    if (ok && !ok.includes(v)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Keeps a page's filters in its link (v3), so a teammate opening it sees the same list: reads them
 * once on arrival (`apply`), then mirrors every change with replaceState (Back still leaves the page).
 * Search text never goes in the link: it can hold a phone number or a name.
 */
export function useLinkedFilters(
  values: LinkParams,
  defaults: LinkParams,
  apply: (got: LinkParams) => void,
  allowed: LinkAllowed = {},
) {
  const ready = useRef(false);
  const latest = useRef({ defaults, apply, allowed });
  latest.current = { defaults, apply, allowed };
  useEffect(() => {
    const { defaults: d, apply: a, allowed: ok } = latest.current;
    const got = readParams(window.location.search, d, ok);
    if (Object.keys(got).length > 0) a(got);
  }, []);
  const key = JSON.stringify(values);
  useEffect(() => {
    // The first pass still holds the defaults: writing them would wipe the link before it is read.
    if (!ready.current) {
      ready.current = true;
      return;
    }
    const url = new URL(window.location.href);
    const next = writeParams(url.search, values, latest.current.defaults);
    if (next !== url.search) window.history.replaceState(window.history.state, '', `${url.pathname}${next}${url.hash}`);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
