export { LIGHT_CHECK_MS } from './light-check';

type Maplibre = typeof import('maplibre-gl');

let protocolAdded = false;
/** Web, once per page: the `pmtiles://` protocol and the Arabic text shaping our labels need. */
export async function prepareGolden(maplibregl: Maplibre): Promise<void> {
  if (!protocolAdded) {
    const { Protocol } = await import('pmtiles');
    maplibregl.addProtocol('pmtiles', new Protocol().tile);
    protocolAdded = true;
  }
  if (maplibregl.getRTLTextPluginStatus() === 'unavailable') {
    const { RTL_TEXT_PLUGIN_URL } = await import('@driver/map');
    void maplibregl.setRTLTextPlugin(RTL_TEXT_PLUGIN_URL, true).catch(() => undefined);
  }
}
