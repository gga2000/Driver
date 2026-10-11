import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import type { LayerProps } from '@maplibre/maplibre-react-native';
import * as golden from '@driver/map/golden';
import { nativeMapLibre } from './native-maplibre';

type Pt = [number, number];
type Light = ReturnType<typeof golden.resolveLight>['light'];
export type Road = { cls: string; coords: Pt[] };

/**
 * Phones move the cars and walkers about 12 times a second: each step crosses the bridge, so only
 * what moves is sent again; parked cars and people standing go once per camera stop.
 */
const LIFE_STEP_MS = 83;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface StreetLifeLayersProps {
  /** The streets on screen from the last camera stop (null: too far out for life). */
  roads: Road[] | null;
  light: Light;
  /** Reduce motion: cars stay parked and people stand. */
  still: boolean;
  beforeId: string;
}

/**
 * Street life on phones (spec "Street life", web: TrackMap3D.web.tsx): the same seeded scene of
 * Iraqi-white cars, tuktuks and people, split into a still source and a moving one.
 */
export function StreetLifeLayers({ roads, light, still, beforeId }: StreetLifeLayersProps) {
  const ml = nativeMapLibre()!;
  const scene = useMemo(() => (roads?.length ? golden.streetLife(roads, { seed: 7, light, moving: !still }) : null), [roads, light, still]);
  const parts = useMemo(() => {
    if (!scene) return null;
    const standing = scene.people.filter((p) => !p.walk);
    const walking = scene.people.filter((p) => p.walk);
    return {
      fixed: golden.lifeFrame({ ...scene, movers: [], people: standing, moving: false }, 0) as GeoJSON.FeatureCollection,
      moving: { parked: [], people: walking, movers: scene.movers, moving: scene.moving },
    };
  }, [scene]);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const animate = Boolean(parts && parts.moving.moving && (parts.moving.movers.length || parts.moving.people.length) && active);
  useEffect(() => {
    if (!animate) return;
    const id = setInterval(() => setNow(Date.now() / 1000), LIFE_STEP_MS);
    return () => clearInterval(id);
  }, [animate]);

  const moving = parts ? (golden.lifeFrame(parts.moving, now) as GeoJSON.FeatureCollection) : EMPTY;
  const [fixedLayer] = golden.goldenLifeLayers({ source: 'track-life-fixed', id: 'track-life-fixed' });
  const [movingLayer] = golden.goldenLifeLayers({ source: 'track-life-moving', id: 'track-life-moving' });
  const props = (l: typeof fixedLayer) => ({ ...l, beforeId }) as unknown as LayerProps;

  return (
    <>
      <ml.GeoJSONSource id="track-life-fixed" data={parts?.fixed ?? EMPTY}>
        <ml.Layer {...props(fixedLayer)} />
      </ml.GeoJSONSource>
      <ml.GeoJSONSource id="track-life-moving" data={moving}>
        <ml.Layer {...props(movingLayer)} />
      </ml.GeoJSONSource>
    </>
  );
}

export interface GlintLayerProps {
  layer: LayerProps;
  light: Light;
  /** Changes on every position update: one glint courier → door, then the line rests. */
  pulse: string;
  /** Reduce motion, or not riding: the line rests. */
  rest: boolean;
}

/** The road ahead with one glint along it after each update (web: `glintGradient` stepped per frame). */
export function GlintLayer({ layer, light, pulse, rest }: GlintLayerProps) {
  const ml = nativeMapLibre()!;
  const [at, setAt] = useState<number | null>(null);

  useEffect(() => {
    if (rest) {
      setAt(null);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => {
      const k = (Date.now() - t0) / golden.TRACKING_GLINT_MS;
      if (k >= 1) {
        clearInterval(id);
        setAt(null);
      } else setAt(k);
    }, 66);
    return () => clearInterval(id);
  }, [pulse, rest]);

  const paint = { ...(layer as { paint?: object }).paint, 'line-gradient': golden.glintGradient('food', light, at) };
  return <ml.Layer {...({ ...layer, paint } as unknown as LayerProps)} />;
}
