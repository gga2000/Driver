/**
 * The few rules of `maplibre-gl.css` the base map needs (canvas placement and touch handling; we draw
 * no MapLibre controls, popups or markers). Added once when the first map opens, so the full
 * stylesheet does not ride in the first page of every visit.
 */
const RULES =
  '.maplibregl-map{overflow:hidden;position:relative;-webkit-tap-highlight-color:rgb(0 0 0/0)}' +
  '.maplibregl-canvas{left:0;position:absolute;top:0}' +
  '.maplibregl-canvas-container.maplibregl-interactive{cursor:grab}' +
  '.maplibregl-canvas-container.maplibregl-interactive:active{cursor:grabbing}' +
  '.maplibregl-canvas-container.maplibregl-touch-zoom-rotate,.maplibregl-canvas-container.maplibregl-touch-zoom-rotate .maplibregl-canvas{touch-action:pan-x pan-y}' +
  '.maplibregl-canvas-container.maplibregl-touch-drag-pan,.maplibregl-canvas-container.maplibregl-touch-drag-pan .maplibregl-canvas{touch-action:pinch-zoom}' +
  '.maplibregl-canvas-container.maplibregl-touch-zoom-rotate.maplibregl-touch-drag-pan,.maplibregl-canvas-container.maplibregl-touch-zoom-rotate.maplibregl-touch-drag-pan .maplibregl-canvas{touch-action:none}' +
  '.maplibregl-boxzoom{background:#fff;border:2px dotted #202020;height:0;left:0;opacity:.5;position:absolute;top:0;width:0}';

const ID = 'driver-maplibre-css';

export function ensureMaplibreCss(): void {
  if (typeof document === 'undefined' || document.getElementById(ID)) return;
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = RULES;
  document.head.appendChild(style);
}
