import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseMapStyle, fallBackToOriginalMap, GOLDEN_SOURCE, type FallbackMap } from './index.js';

const urls = { tilesUrl: 'https://cdn.example.test/map/wasit.pmtiles', glyphsUrl: 'https://cdn.example.test/map/fonts/{fontstack}/{range}.pbf' };

describe('chooseMapStyle', () => {
  it('uses the Golden hour map when both files are set up', () => {
    const { style, golden } = chooseMapStyle({ ...urls, light: 'golden' });
    expect(golden).toBe(true);
    expect(style.sources[GOLDEN_SOURCE]).toMatchObject({ url: 'pmtiles://https://cdn.example.test/map/wasit.pmtiles' });
  });
  it('falls back to the original map when either setting is missing', () => {
    for (const missing of [{ tilesUrl: undefined }, { glyphsUrl: '' }]) {
      const { style, golden } = chooseMapStyle({ ...urls, ...missing });
      expect(golden).toBe(false);
      expect(validateStyleMin(style)).toEqual([]);
      expect(style.metadata).toMatchObject({ 'driver:basemap': 'osm-raster-fallback' });
      expect(style.name).toBe('Driver light');
    }
    expect(chooseMapStyle({ fallback: { theme: 'dark' } }).style.name).toBe('Driver dark');
  });
});

describe('fallBackToOriginalMap', () => {
  type Handler = (e: { sourceId?: string; isSourceLoaded?: boolean }) => void;
  let handlers: Record<string, Handler[]>;
  let map: FallbackMap & { setStyle: ReturnType<typeof vi.fn> };
  const emit = (type: string, e: Parameters<Handler>[0]) => [...(handlers[type] ?? [])].forEach((h) => h(e));
  beforeEach(() => {
    vi.useFakeTimers();
    handlers = {};
    map = {
      on: (type: string, h: Handler) => (handlers[type] ??= []).push(h),
      off: (type: string, h: Handler) => (handlers[type] = (handlers[type] ?? []).filter((x) => x !== h)),
      setStyle: vi.fn(),
    } as never;
  });
  afterEach(() => vi.useRealTimers());

  it('swaps to the original map once when our map file fails before it loads', () => {
    const onFallback = vi.fn();
    fallBackToOriginalMap(map, { onFallback });
    emit('error', { sourceId: 'zones' }); // someone else's layer: not ours to judge
    expect(map.setStyle).not.toHaveBeenCalled();
    emit('error', { sourceId: GOLDEN_SOURCE });
    emit('error', { sourceId: GOLDEN_SOURCE });
    expect(map.setStyle).toHaveBeenCalledTimes(1);
    expect(map.setStyle.mock.calls[0]![0].metadata['driver:basemap']).toBe('osm-raster-fallback');
    expect(onFallback).toHaveBeenCalledTimes(1);
  });
  it('swaps when the map file never answers', () => {
    fallBackToOriginalMap(map, { timeoutMs: 8000 });
    vi.advanceTimersByTime(7999);
    expect(map.setStyle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(map.setStyle).toHaveBeenCalledTimes(1);
  });
  it('stays on the Golden hour map once it has loaded, even if a later tile fails', () => {
    fallBackToOriginalMap(map);
    emit('sourcedata', { sourceId: GOLDEN_SOURCE, isSourceLoaded: true });
    emit('error', { sourceId: GOLDEN_SOURCE });
    vi.advanceTimersByTime(60_000);
    expect(map.setStyle).not.toHaveBeenCalled();
  });
  it('stops watching when the screen closes', () => {
    const stop = fallBackToOriginalMap(map);
    stop();
    emit('error', { sourceId: GOLDEN_SOURCE });
    vi.advanceTimersByTime(60_000);
    expect(map.setStyle).not.toHaveBeenCalled();
  });
});
