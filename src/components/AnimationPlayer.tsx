import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { TravelState } from '../types';
import { getVehicle, vehicleModelUrl } from '../utils/vehicles';
import { interpolateAlong, sliceRoute } from '../utils/routing';
import { VehicleLayer } from './VehicleLayer';

interface Props {
  map: maplibregl.Map | null;
  state: TravelState;
  onBack: () => void;
}

function buildFullRoute(state: TravelState): [number, number][] {
  const result: [number, number][] = [];
  for (const seg of state.segments) {
    if (result.length === 0) {
      result.push(...seg.route);
    } else {
      result.push(...seg.route.slice(1));
    }
  }
  return result;
}

/**
 * For each segment, compute the normalized progress value [0..1] at which it ends.
 * Uses actual geodesic length so vehicle transitions happen at the right location.
 */
function computeSegmentBreakpoints(state: TravelState): number[] {
  if (state.segments.length === 0) return [];
  const lengths = state.segments.map(seg =>
    seg.route.length >= 2
      ? turf.length(turf.lineString(seg.route), { units: 'kilometers' })
      : 0,
  );
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total === 0) return state.segments.map((_, i) => (i + 1) / state.segments.length);
  let acc = 0;
  return lengths.map(len => { acc += len; return acc / total; });
}

function vehicleAtProgress(state: TravelState, progress: number, breakpoints: number[]) {
  if (state.segments.length === 0) return state.segments[0];
  for (let i = 0; i < breakpoints.length; i++) {
    if (progress <= breakpoints[i]) return state.segments[i];
  }
  return state.segments[state.segments.length - 1];
}

function routeZoom(totalKm: number): number {
  if (totalKm < 5) return 15;
  if (totalKm < 20) return 14;
  if (totalKm < 80) return 12;
  if (totalKm < 300) return 10;
  if (totalKm < 1500) return 7;
  return 5;
}

export function AnimationPlayer({ map, state, onBack }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(10);
  const [userScale, setUserScale] = useState(1);
  const [kmTraveled, setKmTraveled] = useState(0);
  const [isRecording, setIsRecording] = useState(false);

  const vehicleLayerRef = useRef<VehicleLayer | null>(null);
  const hiddenMarkersRef = useRef<HTMLElement[]>([]);
  const animFrameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const animZoomRef = useRef<number>(10);
  const totalKmRef = useRef<number>(0);
  const segmentBreakpointsRef = useRef<number[]>([]);
  const smoothBearingRef = useRef<number>(0);
  const lastVehicleTypeRef = useRef<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const playRef = useRef<() => void>(() => {});

  const fullRoute = buildFullRoute(state);

  useEffect(() => {
    if (!map || fullRoute.length < 2) return;

    // Precompute lengths once
    const totalKm = turf.length(turf.lineString(fullRoute), { units: 'kilometers' });
    totalKmRef.current = totalKm;
    animZoomRef.current = routeZoom(totalKm);
    segmentBreakpointsRef.current = computeSegmentBreakpoints(state);

    // Hide pre-drawn route so only the growing trail is visible
    if (map.getLayer('routes-line')) {
      map.setLayoutProperty('routes-line', 'visibility', 'none');
    }
    if (map.getLayer('trail-line')) {
      map.setLayoutProperty('trail-line', 'visibility', 'visible');
    }

    // Hide all waypoint / handle markers before adding the vehicle layer
    const existingMarkerEls = Array.from(
      map.getContainer().querySelectorAll<HTMLElement>('.maplibregl-marker'),
    );
    existingMarkerEls.forEach(m => { m.style.visibility = 'hidden'; });
    hiddenMarkersRef.current = existingMarkerEls;

    // Add Three.js vehicle layer
    const layer = new VehicleLayer();
    // Cast needed: MapLibre v4 render signature uses mat4 (gl-matrix), not number[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.addLayer(layer as any);
    vehicleLayerRef.current = layer;

    // Load first segment's vehicle model
    const firstSeg = state.segments[0];
    if (firstSeg) {
      const cfg = getVehicle(firstSeg.vehicle);
      layer.position = fullRoute[0];
      layer.loadModel(vehicleModelUrl(firstSeg.vehicle), cfg.scaleFactor);
      lastVehicleTypeRef.current = firstSeg.vehicle;
    }

    // Set perspective camera at route start
    const { position: startPos, bearing: startBearing } = interpolateAlong(fullRoute, 0);
    smoothBearingRef.current = startBearing;
    layer.bearing = startBearing;
    map.easeTo({
      center: startPos,
      bearing: startBearing,
      pitch: 60,
      zoom: animZoomRef.current,
      duration: 800,
    });

    return () => {
      // Restore markers
      hiddenMarkersRef.current.forEach(m => { m.style.visibility = ''; });
      hiddenMarkersRef.current = [];

      // Remove vehicle layer
      if (map.getLayer('vehicle-layer')) map.removeLayer('vehicle-layer');
      vehicleLayerRef.current = null;
      lastVehicleTypeRef.current = '';

      // Restore route layer
      if (map.getLayer('routes-line')) {
        map.setLayoutProperty('routes-line', 'visibility', 'visible');
      }
      if (map.getLayer('trail-line')) {
        map.setLayoutProperty('trail-line', 'visibility', 'none');
      }
      const trailSrc = map.getSource('trail') as maplibregl.GeoJSONSource | undefined;
      trailSrc?.setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [] },
        properties: {},
      });

      cancelAnimationFrame(animFrameRef.current);
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const stopAnimation = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setIsPlaying(false);
  }, []);

  const animate = useCallback((timestamp: number) => {
    if (!map || fullRoute.length < 2) return;

    if (startTimeRef.current === 0) startTimeRef.current = timestamp;
    const elapsed = timestamp - startTimeRef.current;
    const prog = Math.min(elapsed / (duration * 1000), 1);

    setProgress(prog);
    setKmTraveled(Math.round(prog * totalKmRef.current));

    const { position, bearing } = interpolateAlong(fullRoute, prog);
    const trail = sliceRoute(fullRoute, prog);

    // Smooth the vehicle model's bearing (the 3D model turns, not the map)
    let delta = bearing - smoothBearingRef.current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    smoothBearingRef.current += delta * 0.06;

    // Update 3D vehicle layer
    const layer = vehicleLayerRef.current;
    if (layer) {
      layer.position = position;
      layer.bearing = smoothBearingRef.current;

      // Switch model when entering a new segment
      const seg = vehicleAtProgress(state, prog, segmentBreakpointsRef.current);
      if (seg && seg.vehicle !== lastVehicleTypeRef.current) {
        const cfg = getVehicle(seg.vehicle);
        layer.loadModel(vehicleModelUrl(seg.vehicle), cfg.scaleFactor);
        lastVehicleTypeRef.current = seg.vehicle;
      }
    }

    // Update trail
    const trailSrc = map.getSource('trail') as maplibregl.GeoJSONSource | undefined;
    if (trailSrc && trail.length >= 2) {
      trailSrc.setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: trail },
        properties: {},
      });
    }

    // Chase camera — follow position only, keep bearing fixed (north-up).
    // The 3D model itself rotates to face the direction of travel.
    map.easeTo({
      center: position,
      pitch: 60,
      zoom: animZoomRef.current,
      duration: 80,
      easing: (t) => t,
    });

    if (prog < 1) {
      animFrameRef.current = requestAnimationFrame(animate);
    } else {
      setIsPlaying(false);
      startTimeRef.current = 0;
      if (mediaRecorderRef.current?.state === 'recording') {
        setTimeout(() => mediaRecorderRef.current?.stop(), 200);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fullRoute, duration, state]);

  const play = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setProgress(0);
    setKmTraveled(0);
    startTimeRef.current = 0;

    if (map) {
      const trailSrc = map.getSource('trail') as maplibregl.GeoJSONSource | undefined;
      trailSrc?.setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [] },
        properties: {},
      });

      const { position: startPos, bearing: startBearing } = interpolateAlong(fullRoute, 0);
      smoothBearingRef.current = startBearing;
      map.easeTo({
        center: startPos,
        bearing: startBearing,
        pitch: 60,
        zoom: animZoomRef.current,
        duration: 400,
      });

      // Reload first vehicle
      const layer = vehicleLayerRef.current;
      const firstSeg = state.segments[0];
      if (layer && firstSeg) {
        layer.position = fullRoute[0];
        layer.bearing = startBearing;
        const cfg = getVehicle(firstSeg.vehicle);
        layer.loadModel(vehicleModelUrl(firstSeg.vehicle), cfg.scaleFactor);
        lastVehicleTypeRef.current = firstSeg.vehicle;
      }
    }

    setIsPlaying(true);
    animFrameRef.current = requestAnimationFrame((ts) => {
      startTimeRef.current = ts;
      animate(ts);
    });
  }, [animate, map, fullRoute, state]);

  // Keep playRef current so auto-play timer fires with latest play callback
  useEffect(() => { playRef.current = play; }, [play]);

  // Sync user-controlled scale to the live layer immediately (no model reload needed)
  useEffect(() => {
    if (vehicleLayerRef.current) {
      vehicleLayerRef.current.userScaleFactor = userScale;
      map?.triggerRepaint();
    }
  }, [userScale, map]);

  // Auto-play when entering preview — wait for map camera to settle first
  useEffect(() => {
    if (fullRoute.length < 2) return;
    const id = setTimeout(() => playRef.current(), 800);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — fire once on mount

  const downloadVideo = useCallback(async () => {
    if (!map || fullRoute.length < 2) return;

    const canvas = map.getCanvas();
    const stream = canvas.captureStream(30);

    const mimeTypes = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `travel-video.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      URL.revokeObjectURL(url);
      setIsRecording(false);
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    play();
  }, [map, fullRoute, play]);

  const hasRoute = fullRoute.length >= 2;

  return (
    <div className="absolute inset-0 z-20 flex flex-col pointer-events-none">
      {/* Back button + distance badge — float over the map */}
      <div className="flex items-start justify-between px-4 pt-safe mt-3 pointer-events-auto">
        <button
          onClick={onBack}
          className="w-11 h-11 rounded-full bg-navy/80 backdrop-blur flex items-center justify-center text-white text-xl shadow-lg active:scale-95 transition-transform"
        >
          ←
        </button>

        {isPlaying && (
          <div className="bg-red-500 text-white font-bold text-xl px-6 py-2 rounded-full shadow-lg">
            {kmTraveled.toLocaleString()} km
          </div>
        )}

        <div className="w-11" />
      </div>

      <div className="flex-1" />

      {/* Bottom controls */}
      <div className="pointer-events-auto bg-navy/90 backdrop-blur-md rounded-t-3xl px-5 pt-5 pb-safe">
        <div className="w-full h-1.5 bg-white/20 rounded-full mb-4 overflow-hidden">
          <div
            className="h-full bg-amber rounded-full transition-none"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="flex items-center justify-between mb-1">
          <span className="text-white/70 text-sm">Video length</span>
          <span className="text-white font-bold text-sm">{duration}s</span>
        </div>
        <input
          type="range"
          min={5}
          max={30}
          step={1}
          value={duration}
          onChange={e => setDuration(Number(e.target.value))}
          className="w-full h-2 mb-4 accent-amber"
          disabled={isPlaying}
        />

        <div className="flex items-center justify-between mb-1">
          <span className="text-white/70 text-sm">Model size</span>
          <span className="text-white font-bold text-sm">{userScale.toFixed(1)}×</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={3}
          step={0.1}
          value={userScale}
          onChange={e => setUserScale(Number(e.target.value))}
          className="w-full h-2 mb-4 accent-amber"
        />

        <div className="flex gap-3 mb-4">
          <button
            onClick={isPlaying ? stopAnimation : play}
            disabled={!hasRoute}
            className={[
              'flex-1 py-3 rounded-2xl font-bold text-base transition-all active:scale-95',
              hasRoute ? 'bg-amber text-navy' : 'bg-white/20 text-white/40 cursor-not-allowed',
            ].join(' ')}
          >
            {isPlaying ? '⏹ Stop' : '▶ Play'}
          </button>

          <button
            onClick={downloadVideo}
            disabled={!hasRoute || isRecording}
            className={[
              'flex-1 py-3 rounded-2xl font-bold text-base transition-all active:scale-95',
              hasRoute && !isRecording
                ? 'bg-blue-500 text-white'
                : 'bg-white/20 text-white/40 cursor-not-allowed',
            ].join(' ')}
          >
            {isRecording ? '⏺ Recording…' : '⬇ Download'}
          </button>
        </div>

        {!hasRoute && (
          <p className="text-white/50 text-center text-sm mb-2">
            Add at least 2 waypoints to preview
          </p>
        )}
      </div>
    </div>
  );
}
