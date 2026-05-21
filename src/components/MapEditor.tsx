import {
  useEffect,
  useRef,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { TravelState, TravelAction, Segment, Waypoint } from '../types';
import { getVehicle } from '../utils/vehicles';
import { computeRoute } from '../utils/routing';
import { getStyleUrl } from '../utils/mapStyles';
import type { MapStyleId } from '../types';

export interface MapEditorHandle {
  getMap: () => maplibregl.Map | null;
}

interface Props {
  state: TravelState;
  dispatch: React.Dispatch<TravelAction>;
  addWaypoint: (lng: number, lat: number) => void;
  mapStyle: MapStyleId;
  visible: boolean;
}

// Checkered-flag pin SVG — entire pin filled with a B&W checker pattern
const FLAG_PIN = `<svg viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="chk" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="4" height="4" fill="white"/>
      <rect x="4" y="0" width="4" height="4" fill="black"/>
      <rect x="0" y="4" width="4" height="4" fill="black"/>
      <rect x="4" y="4" width="4" height="4" fill="white"/>
    </pattern>
  </defs>
  <path d="M20 0C9 0 0 9 0 20C0 34 20 52 20 52C20 52 40 34 40 20C40 9 31 0 20 0Z" fill="url(#chk)" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>
</svg>`;

function createWaypointEl(
  waypoints: Waypoint[],
  segments: Segment[],
  waypointId: string,
  isLast: boolean,
  isFirst: boolean,
): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'cursor: grab; user-select: none; touch-action: manipulation;';

  if (isLast && waypoints.length > 1) {
    el.innerHTML = FLAG_PIN;
    el.style.width = '40px';
    el.style.height = '52px';
    return el;
  }

  const outgoingSeg = segments.find(s => s.fromId === waypointId);
  const incomingSeg = segments.find(s => s.toId === waypointId);
  const vehicle = outgoingSeg ? getVehicle(outgoingSeg.vehicle) : null;

  // Show the vehicle emoji only when transport changes (or on the very first waypoint)
  const vehicleChanged = !incomingSeg || !outgoingSeg || incomingSeg.vehicle !== outgoingSeg.vehicle;

  el.style.width = '36px';
  el.style.height = '36px';
  el.style.borderRadius = '50%';
  el.style.background = '#f5a623';
  el.style.border = '2px solid white';
  el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.overflow = 'hidden';

  const emoji = !vehicle ? '📍' : vehicleChanged ? vehicle.emoji : null;
  if (emoji) {
    const inner = document.createElement('span');
    inner.style.cssText = 'font-size:16px;line-height:1;display:block;pointer-events:none;';
    inner.textContent = emoji;
    el.appendChild(inner);
  }

  return el;
}

function createHandleEl(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    line-height: 1;
    cursor: grab;
    user-select: none;
    filter: drop-shadow(0 2px 5px rgba(0,0,0,0.5));
  `;
  el.textContent = '🤏';
  return el;
}

export const MapEditor = forwardRef<MapEditorHandle, Props>(
  ({ state, dispatch, addWaypoint, mapStyle, visible }, ref) => {
    const [mapLoadFailed, setMapLoadFailed] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const handleMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const mapReadyRef = useRef(false);
    const visibleRef = useRef(visible);
    const addWaypointRef = useRef(addWaypoint);
    const segmentsRef = useRef(state.segments);
    const waypointsRef = useRef(state.waypoints);
    const dispatchRef = useRef(dispatch);
    const routeLineClickedRef = useRef(false);
    // Key of the handle marker currently being dragged — used to skip setLngLat during drag
    const draggingHandleRef = useRef<string | null>(null);

    // Keep refs current so stable map handlers always see fresh values
    useEffect(() => { visibleRef.current = visible; }, [visible]);
    useEffect(() => { addWaypointRef.current = addWaypoint; }, [addWaypoint]);
    useEffect(() => { segmentsRef.current = state.segments; }, [state.segments]);
    useEffect(() => { waypointsRef.current = state.waypoints; }, [state.waypoints]);
    useEffect(() => { dispatchRef.current = dispatch; }, [dispatch]);

    useImperativeHandle(ref, () => ({
      getMap: () => mapRef.current,
    }));

    // Init map once
    useEffect(() => {
      if (!containerRef.current) return;

      // Use visualViewport.height (the visible area, excluding Safari chrome) so
      // MapLibre always reads a non-zero, correct container height on iOS Safari,
      // regardless of whether the CSS height chain resolved correctly.
      const applySize = () => {
        if (!containerRef.current) return;
        const h = window.visualViewport?.height ?? window.innerHeight;
        containerRef.current.style.height = `${h}px`;
      };
      applySize();

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: getStyleUrl(mapStyle),
        center: [10, 25],
        zoom: 2,
        preserveDrawingBuffer: true,
        attributionControl: false,
      });

      mapRef.current = map;

      map.on('load', () => {
        // Route line source + layer
        map.addSource('routes', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'routes-line',
          type: 'line',
          source: 'routes',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#e87722',
            'line-width': ['interpolate', ['linear'], ['zoom'], 2, 3, 8, 5],
          },
        });
        // Wide invisible tap-target so the route line is easy to tap on mobile
        map.addLayer({
          id: 'routes-tap',
          type: 'line',
          source: 'routes',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': 'transparent', 'line-width': 28 },
        });

        // Trail source + layer (for animation mode)
        map.addSource('trail', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
        });
        map.addLayer({
          id: 'trail-line',
          type: 'line',
          source: 'trail',
          layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'none' },
          paint: {
            'line-color': '#ef4444',
            'line-width': 4,
          },
        } as maplibregl.LayerSpecification);

        // Tap/click on the route (wide invisible tap layer) → insert intermediate waypoint
        map.on('click', 'routes-tap', (e) => {
          if (!visibleRef.current) return;

          const segmentId = e.features?.[0]?.properties?.segmentId as string | undefined;
          if (!segmentId) return;

          const seg = segmentsRef.current.find(s => s.id === segmentId);
          if (!seg || seg.route.length < 2) return;

          // Snap click to nearest point on the route geometry
          const clickPt = turf.point([e.lngLat.lng, e.lngLat.lat]);
          const nearest = turf.nearestPointOnLine(turf.lineString(seg.route), clickPt);
          const [lng, lat] = nearest.geometry.coordinates;

          const waypoint = {
            id: `wp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            lng,
            lat,
          };
          dispatchRef.current({ type: 'INSERT_WAYPOINT', waypoint, segmentId });
        });

        // Change cursor when hovering over a route line (desktop)
        map.on('mouseenter', 'routes-tap', () => {
          if (visibleRef.current) map.getCanvas().style.cursor = 'crosshair';
        });
        map.on('mouseleave', 'routes-tap', () => {
          map.getCanvas().style.cursor = '';
        });

        mapReadyRef.current = true;
        loadSucceeded = true;
        setMapLoadFailed(false);
        requestAnimationFrame(() => { applySize(); map.resize(); });
      });

      // Auto-retry style load on network failure (up to 3 times, then show manual retry)
      let loadSucceeded = false;
      let retries = 0;
      map.on('error', () => {
        if (loadSucceeded) return;
        retries++;
        if (retries <= 3) {
          setTimeout(() => mapRef.current?.setStyle(getStyleUrl(mapStyle)), retries * 1500);
        } else {
          setMapLoadFailed(true);
        }
      });

      // Click on empty map → add new destination waypoint.
      // Use queryRenderedFeatures to guard against clicks on route segments —
      // this is reliable regardless of MapLibre's layer vs. map event order.
      map.on('click', (e) => {
        if (!visibleRef.current) return;
        const onRoute = map.queryRenderedFeatures(e.point, { layers: ['routes-tap'] });
        if (onRoute.length > 0) return;
        addWaypointRef.current(e.lngLat.lng, e.lngLat.lat);
      });

      // Resize on window resize (orientation change) and visualViewport resize
      // (iOS Safari URL bar show/hide — window.resize does NOT fire for that)
      const onResize = () => { applySize(); map.resize(); };
      window.addEventListener('resize', onResize);
      window.visualViewport?.addEventListener('resize', onResize);

      // ResizeObserver fires whenever the container's pixel size changes (e.g.
      // when --app-height updates), ensuring the MapLibre canvas is kept in sync
      const ro = new ResizeObserver(() => map.resize());
      if (containerRef.current) ro.observe(containerRef.current);

      return () => {
        window.removeEventListener('resize', onResize);
        window.visualViewport?.removeEventListener('resize', onResize);
        ro.disconnect();
        map.remove();
        mapRef.current = null;
        mapReadyRef.current = false;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update map style
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      map.setStyle(getStyleUrl(mapStyle));
      map.once('styledata', () => {
        mapReadyRef.current = true;
        // Re-add sources/layers after style change
        if (!map.getSource('routes')) {
          const segments = segmentsRef.current;
          const features = segments
            .filter(s => s.route.length >= 2)
            .map(s => turf.lineString(s.route, { segmentId: s.id }));

          map.addSource('routes', {
            type: 'geojson',
            data: turf.featureCollection(features),
          });
          map.addLayer({
            id: 'routes-line',
            type: 'line',
            source: 'routes',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#e87722',
              'line-width': ['interpolate', ['linear'], ['zoom'], 2, 3, 8, 5],
            },
          });
          map.addLayer({
            id: 'routes-tap',
            type: 'line',
            source: 'routes',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': 'transparent', 'line-width': 28 },
          });
        }
        if (!map.getSource('trail')) {
          map.addSource('trail', {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
          });
          map.addLayer({
            id: 'trail-line',
            type: 'line',
            source: 'trail',
            layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'none' },
            paint: { 'line-color': '#ef4444', 'line-width': 4 },
          } as maplibregl.LayerSpecification);
        }
      });
    }, [mapStyle]);

    // Sync waypoint markers
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      const { waypoints, segments } = state;
      const existing = markersRef.current;
      const currentIds = new Set(waypoints.map(w => w.id));

      // Remove stale markers
      existing.forEach((marker, id) => {
        if (!currentIds.has(id)) {
          marker.remove();
          existing.delete(id);
        }
      });

      // Helper: update route GeoJSON in real-time while a waypoint is being dragged
      const makeLiveDragHandler = (marker: maplibregl.Marker, waypointId: string) => () => {
        const ll = marker.getLngLat();
        const segs = segmentsRef.current;
        const wps = waypointsRef.current;

        const features = segs
          .map(s => {
            let from: [number, number];
            let to: [number, number];

            if (s.fromId === waypointId) {
              from = [ll.lng, ll.lat];
              const toWp = wps.find(w => w.id === s.toId);
              if (!toWp) return null;
              to = [toWp.lng, toWp.lat];
            } else if (s.toId === waypointId) {
              const fromWp = wps.find(w => w.id === s.fromId);
              if (!fromWp) return null;
              from = [fromWp.lng, fromWp.lat];
              to = [ll.lng, ll.lat];
            } else {
              if (s.route.length < 2) return null;
              return turf.lineString(s.route, { segmentId: s.id });
            }

            const route = computeRoute(from, to, s.vehicle, s.handles);
            return turf.lineString(route, { segmentId: s.id });
          })
          .filter((f): f is NonNullable<typeof f> => f !== null);

        const src = mapRef.current?.getSource('routes') as maplibregl.GeoJSONSource | undefined;
        src?.setData(turf.featureCollection(features) as GeoJSON.FeatureCollection);

        // Move handle markers in real-time for segments connected to the dragged waypoint
        segs.forEach(s => {
          if (s.fromId !== waypointId && s.toId !== waypointId) return;
          const hm = handleMarkersRef.current.get(`${s.id}:mid`);
          if (!hm || draggingHandleRef.current === `${s.id}:mid`) return;
          const fLng = s.fromId === waypointId ? ll.lng : (wps.find(w => w.id === s.fromId)?.lng ?? 0);
          const fLat = s.fromId === waypointId ? ll.lat : (wps.find(w => w.id === s.fromId)?.lat ?? 0);
          const tLng = s.toId   === waypointId ? ll.lng : (wps.find(w => w.id === s.toId)?.lng   ?? 0);
          const tLat = s.toId   === waypointId ? ll.lat : (wps.find(w => w.id === s.toId)?.lat   ?? 0);
          const pos: [number, number] = s.handles.length > 0
            ? [0.25 * fLng + 0.5 * s.handles[0][0] + 0.25 * tLng,
               0.25 * fLat + 0.5 * s.handles[0][1] + 0.25 * tLat]
            : [(fLng + tLng) / 2, (fLat + tLat) / 2];
          hm.setLngLat(pos);
        });
      };

      // Add or update markers
      waypoints.forEach((wp, idx) => {
        const isLast = idx === waypoints.length - 1;
        const isFirst = idx === 0;

        if (existing.has(wp.id)) {
          // Refresh element (vehicle icon may have changed) by recreating marker.
          // Hide briefly to prevent a 1-frame flash at the map origin (0,0).
          existing.get(wp.id)!.remove();
          const el = createWaypointEl(waypoints, segments, wp.id, isLast, isFirst);
          el.style.visibility = 'hidden';
          setupWaypointEl(el, wp.id, segments, isLast);
          const newMarker = new maplibregl.Marker({ element: el, draggable: true, anchor: isLast && waypoints.length > 1 ? 'bottom' : 'center' })
            .setLngLat([wp.lng, wp.lat])
            .addTo(map);
          requestAnimationFrame(() => { el.style.visibility = ''; });
          newMarker.on('drag', makeLiveDragHandler(newMarker, wp.id));
          newMarker.on('dragend', () => {
            const ll = newMarker.getLngLat();
            dispatchRef.current({ type: 'MOVE_WAYPOINT', id: wp.id, lng: ll.lng, lat: ll.lat });
          });
          existing.set(wp.id, newMarker);
        } else {
          const el = createWaypointEl(waypoints, segments, wp.id, isLast, isFirst);
          setupWaypointEl(el, wp.id, segments, isLast);
          const marker = new maplibregl.Marker({
            element: el,
            draggable: true,
            anchor: isLast && waypoints.length > 1 ? 'bottom' : 'center',
          })
            .setLngLat([wp.lng, wp.lat])
            .addTo(map);

          marker.on('drag', makeLiveDragHandler(marker, wp.id));
          marker.on('dragend', () => {
            const ll = marker.getLngLat();
            dispatchRef.current({ type: 'MOVE_WAYPOINT', id: wp.id, lng: ll.lng, lat: ll.lat });
          });

          existing.set(wp.id, marker);
        }
      });

      // Show/hide markers based on mode
      existing.forEach(m => {
        const el = m.getElement();
        el.style.display = visible ? '' : 'none';
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.waypoints, state.segments, visible]);

    function setupWaypointEl(
      el: HTMLElement,
      waypointId: string,
      segments: Segment[],
      _isLast: boolean,
    ) {
      const seg = segments.find(s => s.fromId === waypointId);

      // ── Double-tap: remove waypoint ──────────────────────────────────────
      // Use touchend for reliable double-tap on mobile (no 300 ms click delay).
      // Guard against drag-end being mistaken for a tap: if the touch moved
      // more than 10 px it was a drag and we skip the double-tap counter.
      let lastTap = 0;
      let tapStartX = 0;
      let tapStartY = 0;
      let touchMoved = false;

      el.addEventListener('touchstart', (e) => {
        const t = (e as TouchEvent).touches[0];
        if (t) { tapStartX = t.clientX; tapStartY = t.clientY; }
        touchMoved = false;
      }, { passive: true });

      el.addEventListener('touchmove', (e) => {
        const t = (e as TouchEvent).touches[0];
        if (t) {
          const dx = t.clientX - tapStartX;
          const dy = t.clientY - tapStartY;
          if (Math.sqrt(dx * dx + dy * dy) > 10) touchMoved = true;
        }
      }, { passive: true });

      const fireTap = (e: Event) => {
        if (touchMoved) { touchMoved = false; return; } // drag-end — not a tap
        e.stopPropagation();
        const now = Date.now();
        if (now - lastTap < 350) {
          el.dispatchEvent(new CustomEvent('remove-waypoint', {
            bubbles: true,
            detail: { waypointId },
          }));
          lastTap = 0;
        } else {
          lastTap = now;
        }
      };
      el.addEventListener('touchend', fireTap, { passive: false });
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        el.dispatchEvent(new CustomEvent('remove-waypoint', { bubbles: true, detail: { waypointId } }));
      });

      // ── Long-press (600 ms): open vehicle selector ───────────────────────
      if (!seg) return; // last waypoint has no outgoing segment

      let pressTimer: ReturnType<typeof setTimeout> | null = null;
      let pressStartX = 0;
      let pressStartY = 0;

      const onPressStart = (e: TouchEvent | MouseEvent) => {
        const touch = (e as TouchEvent).touches?.[0];
        pressStartX = touch ? touch.clientX : (e as MouseEvent).clientX;
        pressStartY = touch ? touch.clientY : (e as MouseEvent).clientY;
        el.classList.add('waypoint-pressing');
        pressTimer = setTimeout(() => {
          pressTimer = null;
          el.classList.remove('waypoint-pressing');
          navigator.vibrate?.(40);
          el.dispatchEvent(new CustomEvent('open-vehicle-selector', {
            bubbles: true,
            detail: { segmentId: seg.id, vehicle: seg.vehicle },
          }));
        }, 600);
      };

      const onPressMove = (e: TouchEvent) => {
        // Only cancel if finger moved more than 10px (ignore jitter)
        const touch = e.touches[0];
        if (!touch) return;
        const dx = touch.clientX - pressStartX;
        const dy = touch.clientY - pressStartY;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
          el.classList.remove('waypoint-pressing');
        }
      };

      const onPressEnd = () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        el.classList.remove('waypoint-pressing');
      };

      // Touch (passive so drag still works)
      el.addEventListener('touchstart', onPressStart as EventListener, { passive: true });
      el.addEventListener('touchend', onPressEnd);
      el.addEventListener('touchmove', onPressMove as EventListener, { passive: true });
      // Mouse fallback (desktop)
      el.addEventListener('mousedown', onPressStart as EventListener);
      el.addEventListener('mouseup', onPressEnd);
      el.addEventListener('mouseleave', onPressEnd);
      // Suppress browser context-menu on long-press
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Sync segment handle markers
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !visible) return;

      const { segments, waypoints } = state;
      const existing = handleMarkersRef.current;
      const currentSegIds = new Set(segments.map(s => s.id));

      // Remove stale handle markers
      existing.forEach((_, key) => {
        const segId = key.split(':')[0];
        if (!currentSegIds.has(segId)) {
          existing.get(key)!.remove();
          existing.delete(key);
        }
      });

      // For each segment, show one handle sitting ON the curve (Bézier midpoint at t=0.5)
      segments.forEach(seg => {
        const handleKey = `${seg.id}:mid`;
        const fromWp = waypoints.find(w => w.id === seg.fromId);
        const toWp = waypoints.find(w => w.id === seg.toId);
        const fLng = fromWp?.lng ?? 0, fLat = fromWp?.lat ?? 0;
        const tLng = toWp?.lng ?? 0,  tLat = toWp?.lat ?? 0;

        // Visual position: Bézier midpoint P(0.5) = 0.25A + 0.5H + 0.25B when curved,
        // geographic midpoint for straight segments.
        const handlePos: [number, number] = seg.handles.length > 0
          ? [
              0.25 * fLng + 0.5 * seg.handles[0][0] + 0.25 * tLng,
              0.25 * fLat + 0.5 * seg.handles[0][1] + 0.25 * tLat,
            ]
          : [(fLng + tLng) / 2, (fLat + tLat) / 2];

        if (existing.has(handleKey)) {
          if (draggingHandleRef.current !== handleKey) {
            existing.get(handleKey)!.setLngLat(handlePos);
          }
        } else {
          const el = createHandleEl();
          const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' })
            .setLngLat(handlePos)
            .addTo(map);

          marker.on('dragstart', () => { draggingHandleRef.current = handleKey; });
          marker.on('drag', () => {
            const ll = marker.getLngLat();
            // Back-calculate control point from dragged midpoint: H = 2·P_mid − 0.5·(A+B)
            const liveFrom = waypointsRef.current.find(w => w.id === seg.fromId);
            const liveTo   = waypointsRef.current.find(w => w.id === seg.toId);
            const controlPoint: [number, number] = (liveFrom && liveTo)
              ? [
                  2 * ll.lng - 0.5 * liveFrom.lng - 0.5 * liveTo.lng,
                  2 * ll.lat - 0.5 * liveFrom.lat - 0.5 * liveTo.lat,
                ]
              : [ll.lng, ll.lat];
            const liveSeg = segmentsRef.current.find(s => s.id === seg.id);
            if (!liveSeg || liveSeg.handles.length === 0) {
              dispatch({ type: 'ADD_HANDLE', segmentId: seg.id, handle: controlPoint });
            } else {
              dispatch({ type: 'MOVE_HANDLE', segmentId: seg.id, index: 0, handle: controlPoint });
            }
          });
          marker.on('dragend', () => { draggingHandleRef.current = null; });

          el.addEventListener('click', e => e.stopPropagation());
          existing.set(handleKey, marker);
        }
      });

      // Remove handles for waypoints that no longer exist
      existing.forEach((marker, key) => {
        if (!currentSegIds.has(key.split(':')[0])) {
          marker.remove();
          existing.delete(key);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.segments, visible]);

    // Sync route GeoJSON
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !mapReadyRef.current) return;

      const waitForStyle = () => {
        const src = map.getSource('routes') as maplibregl.GeoJSONSource | undefined;
        if (!src) {
          setTimeout(waitForStyle, 100);
          return;
        }
        const features = state.segments
          .filter(s => s.route.length >= 2)
          .map(s => turf.lineString(s.route, { segmentId: s.id }));

        src.setData(turf.featureCollection(features));
      };
      waitForStyle();
    }, [state.segments]);


    return (
      <>
        <div
          ref={containerRef}
          className="absolute top-0 left-0 w-full"
          style={{ visibility: 'visible' }}
        />
        {mapLoadFailed && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-navy">
            <p className="text-white text-center px-8 text-lg">Map failed to load.<br/><span className="text-white/50 text-sm">Check your connection and try again.</span></p>
            <button
              onClick={() => {
                setMapLoadFailed(false);
                if (mapRef.current) {
                  mapRef.current.setStyle(getStyleUrl(mapStyle));
                }
              }}
              className="px-8 py-3 bg-amber text-navy font-bold rounded-2xl text-base active:scale-95 transition-transform"
            >
              Retry
            </button>
          </div>
        )}
      </>
    );
  },
);

MapEditor.displayName = 'MapEditor';
