import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { TravelState } from '../types';
import { getVehicle } from '../utils/vehicles';
import { interpolateAlong, sliceRoute } from '../utils/routing';

interface Props {
  map: maplibregl.Map | null;
  state: TravelState;
  onBack: () => void;
}

// Build a flat route from all segments (concatenated)
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

// Determine vehicle at a given progress along full route
function vehicleAtProgress(
  state: TravelState,
  progress: number,
): string {
  if (state.segments.length === 0) return '✈️';
  const idx = Math.min(
    Math.floor(progress * state.segments.length),
    state.segments.length - 1,
  );
  const seg = state.segments[idx];
  return seg ? getVehicle(seg.vehicle).emoji : '✈️';
}

export function AnimationPlayer({ map, state, onBack }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(10); // seconds
  const [cameraFollow, setCameraFollow] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isGlobeReady, setIsGlobeReady] = useState(false);

  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null);
  const animFrameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const fullRoute = buildFullRoute(state);

  // Switch to globe mode on mount
  useEffect(() => {
    if (!map) return;

    // Show trail layer
    if (map.getLayer('trail-line')) {
      map.setLayoutProperty('trail-line', 'visibility', 'visible');
    }

    // Switch to globe projection
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (map as any).setProjection({ name: 'globe' });

    // Add atmosphere / space fog
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (map as any).setFog({
      color: 'rgb(186, 210, 235)',
      'high-color': 'rgb(36, 92, 223)',
      'horizon-blend': 0.02,
      'space-color': 'rgb(11, 11, 25)',
      'star-intensity': 0.6,
    });

    // Zoom out to see globe
    if (fullRoute.length > 0) {
      map.flyTo({
        center: fullRoute[Math.floor(fullRoute.length / 2)],
        zoom: 2.5,
        pitch: 20,
        duration: 1200,
      });
    }

    // Create vehicle marker
    const el = document.createElement('div');
    el.style.cssText = 'font-size: 36px; line-height: 1; pointer-events: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));';
    el.textContent = vehicleAtProgress(state, 0);

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' });
    if (fullRoute.length > 0) {
      marker.setLngLat(fullRoute[0]).addTo(map);
    }
    vehicleMarkerRef.current = marker;

    setTimeout(() => setIsGlobeReady(true), 1400);

    return () => {
      // Restore flat map
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).setProjection({ name: 'mercator' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).setFog(null);
      if (map.getLayer('trail-line')) {
        map.setLayoutProperty('trail-line', 'visibility', 'none');
      }
      // Clear trail
      const trailSrc = map.getSource('trail') as maplibregl.GeoJSONSource | undefined;
      trailSrc?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });

      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      cancelAnimationFrame(animFrameRef.current);
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

    const { position, bearing } = interpolateAlong(fullRoute, prog);
    const trail = sliceRoute(fullRoute, prog);

    // Update vehicle marker
    const marker = vehicleMarkerRef.current;
    if (marker) {
      marker.setLngLat(position);
      const el = marker.getElement();
      el.style.transform = `rotate(${bearing}deg)`;
      el.textContent = vehicleAtProgress(state, prog);
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

    // Camera follow
    if (cameraFollow) {
      map.easeTo({ center: position, duration: 80, easing: t => t });
    }

    if (prog < 1) {
      animFrameRef.current = requestAnimationFrame(animate);
    } else {
      setIsPlaying(false);
      startTimeRef.current = 0;
      // Stop recording when animation ends
      if (mediaRecorderRef.current?.state === 'recording') {
        setTimeout(() => mediaRecorderRef.current?.stop(), 200);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fullRoute, duration, cameraFollow, state]);

  const play = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setProgress(0);
    startTimeRef.current = 0;

    // Reset trail
    if (map) {
      const trailSrc = map.getSource('trail') as maplibregl.GeoJSONSource | undefined;
      trailSrc?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });
    }

    setIsPlaying(true);
    animFrameRef.current = requestAnimationFrame((ts) => {
      startTimeRef.current = ts;
      animate(ts);
    });
  }, [animate, map]);

  // Restart when play changes
  useEffect(() => {
    if (isPlaying) {
      // already started via play()
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying]);

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
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-safe mt-3 pointer-events-auto">
        <button
          onClick={onBack}
          className="w-11 h-11 rounded-full bg-navy/80 backdrop-blur flex items-center justify-center text-white text-xl shadow-lg active:scale-95 transition-transform"
        >
          ←
        </button>
        <h1 className="text-white font-bold text-lg tracking-wide drop-shadow-lg">
          Preview Video
        </h1>
        <button
          onClick={() => setCameraFollow(f => !f)}
          className={[
            'w-11 h-11 rounded-full backdrop-blur flex items-center justify-center text-xl shadow-lg active:scale-95 transition-all',
            cameraFollow ? 'bg-amber text-navy' : 'bg-navy/80 text-white',
          ].join(' ')}
          title="Camera follow"
        >
          🎥
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom controls */}
      <div className="pointer-events-auto bg-navy/90 backdrop-blur-md rounded-t-3xl px-5 pt-5 pb-safe">
        {/* Progress bar */}
        <div className="w-full h-1.5 bg-white/20 rounded-full mb-4 overflow-hidden">
          <div
            className="h-full bg-amber rounded-full transition-none"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Video length */}
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

        {/* Action buttons */}
        <div className="flex gap-3 mb-4">
          {/* Play / Stop */}
          <button
            onClick={isPlaying ? stopAnimation : play}
            disabled={!hasRoute || !isGlobeReady}
            className={[
              'flex-1 py-3 rounded-2xl font-bold text-base transition-all active:scale-95',
              hasRoute && isGlobeReady
                ? 'bg-amber text-navy'
                : 'bg-white/20 text-white/40 cursor-not-allowed',
            ].join(' ')}
          >
            {isPlaying ? '⏹ Stop' : '▶ Play'}
          </button>

          {/* Download */}
          <button
            onClick={downloadVideo}
            disabled={!hasRoute || isRecording || !isGlobeReady}
            className={[
              'flex-1 py-3 rounded-2xl font-bold text-base transition-all active:scale-95',
              hasRoute && !isRecording && isGlobeReady
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
