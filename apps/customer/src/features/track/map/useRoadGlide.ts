import { useEffect, useMemo, useRef } from 'react';
import { cancelAnimation, Easing, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import type { LatLng } from '@driver/contracts';
import { decodePolyline } from '@driver/map';
import { buildPath, glidePos, planGlide, projectOnPath, REROUTE_OFF_M, tailSpan, type Glide, type Path } from '../motion';

/** Ask for a new road at most this often when he keeps straying from it. */
const REROUTE_MIN_GAP_MS = 15_000;

/** A fix as both maps get it: the tracking screen's courier position, the share page's car. */
export interface GlideFix {
  pin: LatLng;
  at: Date;
  bearing: number | null;
  speedKmh: number | null;
}

export interface RoadGlide {
  glide: SharedValue<Glide | null>;
  progress: SharedValue<number>;
  path: SharedValue<Path | null>;
  /** A road shape is drawn (else straight dashed lines). */
  onRoad: boolean;
}

/**
 * The vehicle between fixes (maps program SP5a), shared by the tracking map and the share page: each
 * new fix becomes a glide along the road (`polyline6`) over `intervalMs`, then — while he is moving
 * and the signal is fresh — a short dead-reckoning tail; no backwards hops over small corrections;
 * a new road takes over from where the marker is. When he strays from the road, `onStray` asks for a
 * new one (not more than every 15 s).
 */
export function useRoadGlide({ fix, polyline6, stale, intervalMs, onStray }: { fix: GlideFix | null; polyline6: string | null; stale: boolean; intervalMs: number; onStray: () => void }): RoadGlide {
  const road = useMemo<Path | null>(() => (polyline6 ? buildPath(decodePolyline(polyline6)) : null), [polyline6]);
  const glide = useSharedValue<Glide | null>(null);
  const progress = useSharedValue(1);
  const path = useSharedValue<Path | null>(null);
  const roadRef = useRef<Path | null>(null);
  const lastReroute = useRef(0);
  const strayRef = useRef(onStray);
  strayRef.current = onStray;

  // A new road: finish where the marker is, as a still glide, and plan the next fix on the new road.
  useEffect(() => {
    const g = glide.value;
    if (g) {
      const here = glidePos(g, roadRef.current, progress.value);
      glide.value = { kind: 'line', from: here.pos, to: here.pos, fromHeading: here.heading, toHeading: here.heading };
      progress.value = 1;
    }
    roadRef.current = road;
    path.value = road;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [road]);

  const fixKey = fix ? `${fix.at.getTime()}:${fix.pin.lat}:${fix.pin.lng}` : 'none';
  useEffect(() => {
    if (!fix) {
      glide.value = null;
      return;
    }
    const target = { lat: fix.pin.lat, lng: fix.pin.lng, bearing: fix.bearing, speedKmh: fix.speedKmh };
    const g = glide.value;
    if (!g) {
      const h = fix.bearing ?? 0;
      glide.value = { kind: 'line', from: target, to: target, fromHeading: h, toHeading: h };
      progress.value = 1;
      return;
    }
    const current = roadRef.current;
    const next = planGlide(current, glidePos(g, current, progress.value), target, intervalMs);
    glide.value = next;
    // Glide over one interval, then (when moving) keep going for the dead-reckoning tail.
    const span = 1 + (stale ? 0 : tailSpan(next, intervalMs));
    progress.value = 0;
    progress.value = withTiming(span, { duration: intervalMs * span, easing: Easing.linear });
    const now = Date.now();
    if (current && projectOnPath(current, target).offM > REROUTE_OFF_M && now - lastReroute.current > REROUTE_MIN_GAP_MS) {
      lastReroute.current = now;
      strayRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixKey]);

  // Signal lost: stop dead reckoning where he is.
  useEffect(() => {
    if (stale) cancelAnimation(progress);
  }, [stale, progress]);

  return { glide, progress, path, onRoad: road !== null };
}
