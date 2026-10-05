'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { SAFETY_DESK_ROLES } from '@driver/contracts';
import { createLiveConnection, isLiveAuthError, type LiveConnection } from '@driver/contracts/live-client';
import { queryRetry } from './live';
import { hasAny, useMyRoles } from './me';
import { useSignedIn } from './session';
import { liveTokensOf, useTRPC, useTRPCClient } from './trpc';

/** The banner never depends on the stream alone: it also re-reads this often. */
export const SAFETY_POLL_MS = 5_000;

let shared: { conn: LiveConnection; refs: number } | null = null;
const NONE: never[] = [];

/**
 * Open SOS alerts for the red banner on every page (and the desk). One `live.safety` SSE stream per
 * tab (ref-counted) re-reads `safety.*` the moment something happens; a 5-s poll covers networks
 * that buffer SSE. Only for the roles that answer alerts (dispatchers, support, admins).
 */
export function useSafetyAlerts() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  const { roles, loaded } = useMyRoles();
  const allowed = loaded && hasAny(roles, SAFETY_DESK_ROLES);

  useEffect(() => {
    if (!signedIn || !allowed) return;
    if (shared) {
      shared.refs += 1;
    } else {
      const refresh = () => {
        void qc.invalidateQueries(trpc.safety.list.pathFilter());
        void qc.invalidateQueries(trpc.safety.get.pathFilter());
      };
      const conn = createLiveConnection({
        open: (h) => client.live.safety.subscribe(undefined, h),
        onEvent: (e) => {
          if (e.type === 'invalidate' && e.keys.includes('safety.open')) refresh();
        },
        onResync: refresh,
        isAuthError: isLiveAuthError,
        onAuthError: () => liveTokensOf(client)?.clear(),
      });
      shared = { conn, refs: 1 };
      conn.start();
    }
    return () => {
      if (!shared) return;
      shared.refs -= 1;
      if (shared.refs > 0) return;
      shared.conn.stop();
      shared = null;
    };
  }, [signedIn, allowed, trpc, client, qc]);

  const q = useQuery(trpc.safety.list.queryOptions({ scope: 'open', limit: 50 }, { enabled: signedIn && allowed, refetchInterval: SAFETY_POLL_MS, retry: queryRetry }));
  return { rows: q.data ?? NONE, query: q, allowed };
}

// ───────────────────────── the alarm ─────────────────────────

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctx = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return null;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }
  return ctx;
}

/** Three urgent beeps (two-tone), louder than the dispatch chime. */
function alarm(c: AudioContext) {
  [
    [0, 988],
    [0.28, 740],
    [0.56, 988],
  ].forEach(([at, hz]) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'square';
    osc.frequency.value = hz!;
    gain.gain.setValueAtTime(0.0001, c.currentTime + at!);
    gain.gain.exponentialRampToValueAtTime(0.12, c.currentTime + at! + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at! + 0.24);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime + at!);
    osc.stop(c.currentTime + at! + 0.26);
  });
}

/**
 * Rings every 2.5 s while `ringing`. Browsers allow sound only after the page was touched; the first
 * click or key anywhere unlocks it, and until then `blocked` says so (the banner shows it).
 */
export function useSafetyAlarm(ringing: boolean): { blocked: boolean } {
  const [blocked, setBlocked] = useState(false);
  const ringingRef = useRef(ringing);
  ringingRef.current = ringing;
  useEffect(() => {
    const c = audio();
    if (!c) return;
    const sync = () => setBlocked(c.state !== 'running');
    sync();
    const unlock = () => void c.resume().then(sync, sync);
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    c.addEventListener('statechange', sync);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      c.removeEventListener('statechange', sync);
    };
  }, []);
  useEffect(() => {
    if (!ringing) return;
    const ring = () => {
      const c = audio();
      if (c && c.state === 'running' && ringingRef.current) alarm(c);
    };
    ring();
    const id = window.setInterval(ring, 2_500);
    return () => window.clearInterval(id);
  }, [ringing]);
  return { blocked: blocked && ringing };
}
