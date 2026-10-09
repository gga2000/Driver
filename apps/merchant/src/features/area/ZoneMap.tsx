/**
 * The zone map on phones and tablets: the plain SVG drawing (`ZoneMapSvg`). The web build draws the same
 * zones on the Golden hour street map (`ZoneMap.web.tsx`); the native street map waits on a development
 * build.
 */
export { ZoneMapSvg as ZoneMap, type MapZone, type ZoneMapProps } from './ZoneMapSvg';
