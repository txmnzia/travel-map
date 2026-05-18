import {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { TravelState, TravelAction, Segment, Waypoint } from '../types';
import { getVehicle } from '../utils/vehicles';
import { computeRoute, routeMidpoint } from '../utils/routing';
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

// Checkered-flag pin SVG for the last waypoint
const FLAG_PIN = `<svg viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 0C9 0 0 9 0 20C0 34 20 52 20 52C20 52 40 34 40 20C40 9 31 0 20 0Z" fill="#f5a623"/>
  <rect x="10" y="8" width="5" height="5" fill="white"/>
  <rect x="15" y="8" width="5" height="5" fill="black"/>
  <rect x="10" y="13" width="5" height="5" fill="black"/>
  <rect x="15" y="13" width="5" height="5" fill="white"/>
  <rect x="10" y="18" width="5" height="5" fill="white"/>
  <rect x="15" y="18" width="5" height="5" fill="black"/>
  <rect x="10" y="23" width="5" height="5" fill="black"/>
  <rect x="15" y="23" width="5" height="5" fill="white"/>
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

  el.style.width = '42px';
  el.style.height = '42px';
  el.style.borderRadius = '50%';
  el.style.background = '#f5a623';
  el.style.border = '3px solid white';
  el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.fontSize = '18px';
  el.style.color = 'white';

  if (!vehicle) {
    el.textContent = '📍'; // solo waypoint, no segment yet
  } else if (vehicleChanged) {
    el.textContent = vehicle.emoji; // transport changes here — show icon
  }
  // else: same transport — leave circle empty (plain amber dot)

  return el;
}

function createHandleEl(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #f5a623;
    border: 3px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    cursor: grab;
    user-select: none;
    display: none;
  `;
  return el;
}

export const MapEditor = forwardRef<MapEditorHandle, Props>(
  ({ state, dispatch, addWaypoint, mapStyle, visible }, ref) => {
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
    // Flag to swallow the map click when a route-line click already handled it
    const routeLineClickedRef = useRef(false);

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
            'line-width': 3,
            'line-dasharray': [2, 3],
          },
        } as maplibregl.LayerSpecification);

        // Tap/click on the route (wide invisible tap layer) → insert intermediate waypoint
        map.on('click', 'routes-tap', (e) => {
          if (!visibleRef.current) return;
          routeLineClickedRef.current = true;

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
      });

      // Click on empty map → add new destination waypoint
      // (guarded by the route-line flag to prevent double-firing)
      map.on('click', (e) => {
        if (!visibleRef.current) return;
        if (routeLineClickedRef.current) {
          routeLineClickedRef.current = false;
          return;
        }
        addWaypointRef.current(e.lngLat.lng, e.lngLat.lat);
      });

      return () => {
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
            paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-dasharray': [2, 3] },
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
      };

      // Add or update markers
      waypoints.forEach((wp, idx) => {
        const isLast = idx === waypoints.length - 1;
        const isFirst = idx === 0;

        if (existing.has(wp.id)) {
          // Refresh element (vehicle icon may have changed) by recreating marker
          existing.get(wp.id)!.remove();
          const el = createWaypointEl(waypoints, segments, wp.id, isLast, isFirst);
          setupWaypointEl(el, wp.id, segments, isLast);
          const newMarker = new maplibregl.Marker({ element: el, draggable: true, anchor: isLast && waypoints.length > 1 ? 'bottom' : 'center' })
            .setLngLat([wp.lng, wp.lat])
            .addTo(map);
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
      // Use touchend for reliable double-tap on mobile (no 300 ms click delay)
      let lastTap = 0;
      const fireTap = (e: Event) => {
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

      // For each segment, show one mid-handle (at midpoint of route)
      segments.forEach(seg => {
        const midpoint = routeMidpoint(seg.route);
        const handleKey = `${seg.id}:mid`;

        if (existing.has(handleKey)) {
          existing.get(handleKey)!.setLngLat(midpoint);
        } else {
          const el = createHandleEl();
          const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' })
            .setLngLat(midpoint)
            .addTo(map);

          // Track whether this handle has been added to state yet
          // (avoids stale closure bug: seg.handles captured at effect-time)
          let handleAdded = seg.handles.length > 0;

          marker.on('drag', () => {
            const ll = marker.getLngLat();
            if (!handleAdded) {
              dispatch({ type: 'ADD_HANDLE', segmentId: seg.id, handle: [ll.lng, ll.lat] });
              handleAdded = true;
            } else {
              dispatch({ type: 'MOVE_HANDLE', segmentId: seg.id, index: 0, handle: [ll.lng, ll.lat] });
            }
          });
          // Prevent map click when interacting with handle
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

    // Fit map to route when waypoints change
    useEffect(() => {
      const map = mapRef.current;
      if (!map || state.waypoints.length < 2) return;

      const coords = state.waypoints.map(w => [w.lng, w.lat] as [number, number]);
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0]),
      );
      map.fitBounds(bounds, { padding: 100, maxZoom: 8, duration: 600 });
    }, [state.waypoints.length]);

    return (
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ visibility: 'visible' }}
      />
    );
  },
);

MapEditor.displayName = 'MapEditor';
