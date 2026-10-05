import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Easing, runOnJS, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { fitCamera, mercX, mercY, project, type Camera, type LngLat, type Size } from '../geo';

/** Before anything is known: the town. */
export const AZIZIYAH_CAMERA: Camera = { lat: 32.9085, lng: 45.0655, zoom: 13.5 };
const FOLLOW_MS = 800;

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FollowCamera {
  cam: { lng: SharedValue<number>; lat: SharedValue<number>; zoom: SharedValue<number> };
  /** The camera the base map last settled on (tiles draw for it; overlays use `cam`). */
  drawn: Camera;
  setDrawn: (c: Camera) => void;
  /** False once the person moved the map; `recentre` brings it back. */
  follow: boolean;
  stopFollowing: () => void;
  recentre: () => void;
}

/**
 * A camera that keeps `focus` framed inside `pad` within `zoom` (maps program SP5b), shared by the
 * tracking map and the share page. It moves only when the frame is off by a noticeable amount or a
 * focus point is about to leave the map (no seasickness); any gesture hands the camera to the person
 * until `recentre`.
 */
export function useFollowCamera({ size, focus, zoom, pad }: { size: Size; focus: readonly LngLat[]; zoom: readonly [number, number]; pad: Insets }): FollowCamera {
  const lng = useSharedValue(AZIZIYAH_CAMERA.lng);
  const lat = useSharedValue(AZIZIYAH_CAMERA.lat);
  const z = useSharedValue(AZIZIYAH_CAMERA.zoom);
  const cam = useMemo(() => ({ lng, lat, zoom: z }), [lng, lat, z]);
  const [drawn, setDrawn] = useState<Camera>(AZIZIYAH_CAMERA);
  const [follow, setFollow] = useState(true);
  const placed = useRef(false);

  const focusKey = focus.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
  const frame = useCallback(
    (force: boolean) => {
      if (size.w === 0 || focus.length === 0) return;
      const target = fitCamera(focus, size, pad, [zoom[0], zoom[1]]);
      if (!placed.current) {
        placed.current = true;
        lng.value = target.lng;
        lat.value = target.lat;
        z.value = target.zoom;
        setDrawn(target);
        return;
      }
      // Move only when the frame is off by a noticeable amount — or when a focus point is about to
      // leave the visible map (half the padding as margin).
      const zz = z.value;
      const dx = Math.abs(mercX(target.lng, zz) - mercX(lng.value, zz));
      const dy = Math.abs(mercY(target.lat, zz) - mercY(lat.value, zz));
      const now = { lng: lng.value, lat: lat.value, zoom: zz };
      const inView = focus.every((p) => {
        const at = project(p.lat, p.lng, now, size);
        return at.x >= pad.left / 2 && at.x <= size.w - pad.right / 2 && at.y >= pad.top / 2 && at.y <= size.h - pad.bottom / 2;
      });
      if (!force && inView && dx < size.w * 0.12 && dy < size.h * 0.1 && Math.abs(target.zoom - zz) < 0.4) return;
      const ease = { duration: FOLLOW_MS, easing: Easing.inOut(Easing.cubic) };
      lng.value = withTiming(target.lng, ease);
      lat.value = withTiming(target.lat, ease);
      z.value = withTiming(target.zoom, ease, (done) => {
        if (done) runOnJS(setDrawn)(target);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size, focusKey, zoom[0], zoom[1], pad.top, pad.bottom, pad.left, pad.right],
  );

  useEffect(() => {
    if (follow) frame(false);
  }, [frame, follow]);

  return {
    cam,
    drawn,
    setDrawn,
    follow,
    stopFollowing: () => setFollow(false),
    recentre: () => {
      setFollow(true);
      frame(true);
    },
  };
}
