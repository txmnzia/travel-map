import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { TravelState } from '../types';
import { getVehicle, vehicleModelUrl, VehicleConfig } from '../utils/vehicles';
import { RouteSampler } from '../utils/routing';
import { VehicleLayer } from './VehicleLayer';

/** Draw the red km pill onto the recording canvas (mirrors the DOM badge). */
function drawKmBadge(ctx: CanvasRenderingContext2D, canvasWidth: number, dpr: number, text: string) {
  const fontSize = 20 * dpr;
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  const textW = ctx.measureText(text).width;
  const padX = 24 * dpr;
  const h = 44 * dpr;
  const w = textW + padX * 2;
  const x = (canvasWidth - w) / 2;
  const y = 24 * dpr;
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, h / 2);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvasWidth / 2, y + h / 2);
}

/** Stamp the arrival flag onto the recording canvas at the destination's screen position. */
function drawArrivalFlag(ctx: CanvasRenderingContext2D, map: maplibregl.Map, dest: [number, number], dpr: number) {
  const pt = map.project({ lng: dest[0], lat: dest[1] });
  ctx.font = `${38 * dpr}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  // Slight left offset so the flagpole sits on the destination point
  ctx.fillText('🚩', pt.x * dpr - 4 * dpr, pt.y * dpr);
}

interface Props {
  map: maplibregl.Map | null;
  state: TravelState;
  onBack: () => void;
}

function applyVehicle(layer: VehicleLayer, cfg: VehicleConfig, type: string, color: string | null = null) {
  layer.bobEnabled = cfg.category === 'Boats';
  if (cfg.fbxUrl) {
    layer.loadFBX(cfg.fbxUrl, cfg.animUrl ?? null, cfg.skinUrl ?? null, cfg.scaleFactor, cfg.idleUrl ?? null);
  } else if (cfg.partUrls) {
    layer.loadParts(cfg.partUrls, cfg.scaleFactor, cfg.colormapUrl);
  } else {
    layer.loadModel(vehicleModelUrl(type as Parameters<typeof vehicleModelUrl>[0]), cfg.scaleFactor);
  }
  if (!cfg.fbxUrl) layer.setTint(color);
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
  const [duration, setDuration] = useState(10);
  const [userScale, setUserScale] = useState(1);
  const [cameraMode, setCameraMode] = useState<'static' | 'pov'>('static');
  const [showCounter, setShowCounter] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const vehicleLayerRef = useRef<VehicleLayer | null>(null);
  const samplerRef = useRef<RouteSampler | null>(null);
  const kmBadgeRef = useRef<HTMLDivElement | null>(null);  // km text set imperatively — 60 fps setState re-rendered the whole panel
  const showCounterRef = useRef(true);
  const flagShownRef = useRef(false);                      // arrival flag visible → compositor stamps it into the video
  const stopCompositorRef = useRef<(() => void) | null>(null);
  const hiddenMarkersRef = useRef<HTMLElement[]>([]);
  const animFrameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const progressRef = useRef<number>(0);     // mirrors progress state, readable in callbacks
  const resumeFromRef = useRef<number>(0);   // saved progress when stopped mid-route
  const animZoomRef = useRef<number>(10);
  const totalKmRef = useRef<number>(0);
  const segmentBreakpointsRef = useRef<number[]>([]);
  const smoothBearingRef = useRef<number>(0);
  const lastVehicleTypeRef = useRef<string>('');
  const lastColorRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoBlobRef = useRef<{ blob: Blob; mimeType: string; ext: string } | null>(null);
  const recordingCompletedRef = useRef(false);
  const playRef = useRef<() => void>(() => {});
  const cameraModeRef = useRef<'static' | 'pov'>('static');
  const arrivalFlagRef = useRef<maplibregl.Marker | null>(null);

  const fullRoute = buildFullRoute(state);

  useEffect(() => {
    if (!map || fullRoute.length < 2) return;

    // Precompute cumulative route distances once — the animation loop and each
    // train wagon query position/bearing every frame
    const sampler = new RouteSampler(fullRoute);
    samplerRef.current = sampler;
    totalKmRef.current = sampler.totalKm;
    animZoomRef.current = routeZoom(sampler.totalKm);
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

    // Surface model-load failures instead of animating an invisible vehicle silently
    let errToastTimer: ReturnType<typeof setTimeout> | null = null;
    layer.onLoadError = () => {
      setLoadError('Could not load the vehicle model. Check your connection and try again.');
      if (errToastTimer) clearTimeout(errToastTimer);
      errToastTimer = setTimeout(() => setLoadError(null), 5000);
    };

    // Give the layer the route sampler so train wagons can look up their individual positions
    layer.sampler = sampler;
    layer.progress = 0;

    // Load first segment's vehicle model
    const firstSeg = state.segments[0];
    if (firstSeg) {
      const cfg = getVehicle(firstSeg.vehicle);
      layer.position = fullRoute[0];
      applyVehicle(layer, cfg, firstSeg.vehicle, firstSeg.color ?? null);
      lastVehicleTypeRef.current = firstSeg.vehicle;
      lastColorRef.current = firstSeg.color ?? null;
    }

    // Set perspective camera at route start
    const { position: startPos, bearing: startBearing } = sampler.at(0);
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
      if (arrivalFlagRef.current) { arrivalFlagRef.current.remove(); arrivalFlagRef.current = null; }

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

      if (errToastTimer) clearTimeout(errToastTimer);
      cancelAnimationFrame(animFrameRef.current);

      // Tear down any in-flight recording — otherwise the canvas capture
      // pipeline, compositor loop, and encoder keep running after leaving preview
      recordingCompletedRef.current = false;
      stopCompositorRef.current?.();
      const rec = mediaRecorderRef.current;
      if (rec) {
        if (rec.state === 'recording') rec.stop();
        rec.stream.getTracks().forEach(t => t.stop());
        mediaRecorderRef.current = null;
      }

      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const stopAnimation = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setIsPlaying(false);
    resumeFromRef.current = progressRef.current < 1 ? progressRef.current : 0;
    vehicleLayerRef.current?.pauseAnimation();
    // Discard partial recording — only a full animation completion produces a saveable video
    recordingCompletedRef.current = false;
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setVideoReady(false);
    videoBlobRef.current = null;
  }, []);

  const shareVideo = useCallback(async () => {
    const info = videoBlobRef.current;
    if (!info) return;
    const file = new File([info.blob], `travel-video.${info.ext}`, { type: info.mimeType });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: 'My Trip' });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return; // user cancelled — keep button ready
      }
    } else {
      // Desktop: anchor download
      const url = URL.createObjectURL(info.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `travel-video.${info.ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    }
    videoBlobRef.current = null;
    setVideoReady(false);
  }, []);

  const animate = useCallback((timestamp: number) => {
    if (!map || fullRoute.length < 2) return;

    if (startTimeRef.current === 0) startTimeRef.current = timestamp;
    const elapsed = timestamp - startTimeRef.current;
    // Allow progress beyond 1 so rear wagons can reach the destination naturally.
    // Cap display values at 1 for the UI.
    const prog = elapsed / (duration * 1000);
    const displayProg = Math.min(prog, 1);

    progressRef.current = displayProg;
    if (kmBadgeRef.current) {
      kmBadgeRef.current.textContent =
        `${Math.round(displayProg * totalKmRef.current).toLocaleString()} km`;
    }

    const sampler = samplerRef.current ?? new RouteSampler(fullRoute);
    samplerRef.current = sampler;
    const { position, bearing } = sampler.at(displayProg);
    const trail = sampler.slice(displayProg);

    // Smooth the vehicle model's bearing (the 3D model turns, not the map)
    let delta = bearing - smoothBearingRef.current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    smoothBearingRef.current += delta * 0.06;

    // Update 3D vehicle layer — pass uncapped prog so each wagon detects its own arrival
    const layer = vehicleLayerRef.current;
    if (layer) {
      layer.position = position;
      layer.bearing = smoothBearingRef.current;
      layer.progress = prog;

      // Switch model when entering a new segment (use capped value)
      const seg = vehicleAtProgress(state, displayProg, segmentBreakpointsRef.current);
      if (seg && seg.vehicle !== lastVehicleTypeRef.current) {
        const cfg = getVehicle(seg.vehicle);
        applyVehicle(layer, cfg, seg.vehicle, seg.color ?? null);
        lastVehicleTypeRef.current = seg.vehicle;
        lastColorRef.current = seg.color ?? null;
      } else if (seg && (seg.color ?? null) !== lastColorRef.current) {
        lastColorRef.current = seg.color ?? null;
        layer.setTint(seg.color ?? null);
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

    // Camera follows the vehicle until it reaches the destination, then stays put
    map.easeTo({
      center: position,
      ...(cameraModeRef.current === 'pov' ? { bearing: smoothBearingRef.current } : {}),
      pitch: 60,
      zoom: animZoomRef.current,
      duration: 80,
      easing: (t) => t,
    });

    // Done when every part has shrunk out — or, if no visual ever loaded (model
    // 404/parse failure), once progress passes the end plus a small grace period.
    // Without the fallback a failed load would leave this rAF loop (and the
    // recorder) running forever.
    const done = layer
      ? (layer.isFullyDone() || (prog >= 1.05 && !layer.hasVisual()))
      : prog >= 1.05;
    if (!done) {
      animFrameRef.current = requestAnimationFrame(animate);
    } else {
      setIsPlaying(false);
      startTimeRef.current = 0;

      // All wagons gone — pop the arrival flag
      const dest = fullRoute[fullRoute.length - 1];
      if (!document.getElementById('_flag-pop-kf')) {
        const s = document.createElement('style');
        s.id = '_flag-pop-kf';
        s.textContent = '@keyframes _flagPop{0%{transform:scale(0) translateY(8px);opacity:0}75%{transform:scale(1.25) translateY(-3px);opacity:1}100%{transform:scale(1) translateY(0);opacity:1}}';
        document.head.appendChild(s);
      }
      const el = document.createElement('div');
      el.style.cssText = 'cursor:default;user-select:none;';
      const inner = document.createElement('span');
      inner.style.cssText = 'font-size:2.4rem;line-height:1;display:block;animation:_flagPop 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards;transform-origin:bottom center;';
      inner.textContent = '🚩';
      el.appendChild(inner);
      if (arrivalFlagRef.current) arrivalFlagRef.current.remove();
      arrivalFlagRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(dest)
        .addTo(map);
      flagShownRef.current = true; // compositor stamps the flag into the final video frames

      if (mediaRecorderRef.current?.state === 'recording') {
        recordingCompletedRef.current = true;
        setTimeout(() => mediaRecorderRef.current?.stop(), 200);
      }
    }
  }, [map, fullRoute, duration, state]);

  const play = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);

    // Stop any in-progress recording and start fresh
    recordingCompletedRef.current = false;
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setVideoReady(false);
    videoBlobRef.current = null;

    const resumeFrom = resumeFromRef.current;
    const isResume = resumeFrom > 0 && resumeFrom < 1;
    resumeFromRef.current = 0;

    if (!isResume) {
      progressRef.current = 0;
      if (kmBadgeRef.current) kmBadgeRef.current.textContent = '0 km';
      flagShownRef.current = false;
      if (arrivalFlagRef.current) { arrivalFlagRef.current.remove(); arrivalFlagRef.current = null; }
    }

    if (map) {
      if (!isResume) {
        const trailSrc = map.getSource('trail') as maplibregl.GeoJSONSource | undefined;
        trailSrc?.setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [] },
          properties: {},
        });
      }

      const startProg = isResume ? resumeFrom : 0;
      const sampler = samplerRef.current ?? new RouteSampler(fullRoute);
      samplerRef.current = sampler;
      const { position: startPos, bearing: startBearing } = sampler.at(startProg);
      smoothBearingRef.current = startBearing;

      if (!isResume) {
        map.easeTo({
          center: startPos,
          bearing: startBearing,
          pitch: 60,
          zoom: animZoomRef.current,
          duration: 400,
        });
      }

      const layer = vehicleLayerRef.current;
      const seg = isResume
        ? (vehicleAtProgress(state, resumeFrom, segmentBreakpointsRef.current) ?? state.segments[0])
        : state.segments[0];
      if (layer && seg) {
        layer.position = startPos;
        layer.bearing = startBearing;
        if (!isResume) {
          layer.resetForReplay();
          const cfg = getVehicle(seg.vehicle);
          applyVehicle(layer, cfg, seg.vehicle, seg.color ?? null);
        } else {
          layer.resumeAnimation();
        }
        lastVehicleTypeRef.current = seg.vehicle;
        lastColorRef.current = seg.color ?? null;
      }

      // Start background recording silently — video is ready when animation completes.
      // Recording goes through an offscreen 2D canvas that composites the WebGL map
      // with the km counter and arrival flag: those are DOM overlays on screen, so
      // capturing the map canvas alone would silently drop them from the video.
      const mapCanvas = map.getCanvas();
      if (typeof mapCanvas.captureStream === 'function' && typeof MediaRecorder !== 'undefined') {
        try {
          const mimeTypes = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
          const mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
          const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';

          const comp = document.createElement('canvas');
          comp.width = mapCanvas.width;
          comp.height = mapCanvas.height;
          const ctx = comp.getContext('2d')!;

          let compFrame = 0;
          const compose = () => {
            if (comp.width !== mapCanvas.width || comp.height !== mapCanvas.height) {
              comp.width = mapCanvas.width;
              comp.height = mapCanvas.height;
            }
            const dpr = mapCanvas.clientWidth > 0 ? mapCanvas.width / mapCanvas.clientWidth : 1;
            ctx.drawImage(mapCanvas, 0, 0);
            if (showCounterRef.current) {
              const km = Math.round(Math.min(progressRef.current, 1) * totalKmRef.current);
              drawKmBadge(ctx, comp.width, dpr, `${km.toLocaleString()} km`);
            }
            if (flagShownRef.current) {
              drawArrivalFlag(ctx, map, fullRoute[fullRoute.length - 1], dpr);
            }
            compFrame = requestAnimationFrame(compose);
          };
          compose();
          stopCompositorRef.current?.(); // stop a leftover compositor from a previous run
          stopCompositorRef.current = () => {
            cancelAnimationFrame(compFrame);
            stopCompositorRef.current = null;
          };

          const stream = comp.captureStream(30);
          chunksRef.current = [];
          const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
          };
          recorder.onstop = () => {
            if (recordingCompletedRef.current && chunksRef.current.length > 0) {
              const blob = new Blob(chunksRef.current, { type: mimeType });
              if (blob.size > 1000) {
                videoBlobRef.current = { blob, mimeType, ext };
                setVideoReady(true);
              }
            }
            chunksRef.current = [];
            // Release the capture pipeline (each play() creates a fresh compositor+stream)
            stopCompositorRef.current?.();
            stream.getTracks().forEach(t => t.stop());
          };
          mediaRecorderRef.current = recorder;
          recorder.start();
        } catch {
          // MediaRecorder unavailable on this browser — download button stays disabled
        }
      }
    }

    setIsPlaying(true);
    animFrameRef.current = requestAnimationFrame((ts) => {
      // Offset startTime so elapsed maps to resumeFrom
      startTimeRef.current = ts - resumeFrom * duration * 1000;
      animate(ts);
    });
  }, [animate, map, fullRoute, state, duration]);

  // Keep playRef current so auto-play timer fires with latest play callback
  useEffect(() => { playRef.current = play; }, [play]);

  useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode]);
  useEffect(() => { showCounterRef.current = showCounter; }, [showCounter]);

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

        {isPlaying && showCounter && (
          <div ref={kmBadgeRef} className="bg-red-500 text-white font-bold text-xl px-6 py-2 rounded-full shadow-lg">
            0 km
          </div>
        )}

        <div className="w-11" />
      </div>

      {/* Model-load error toast */}
      {loadError && (
        <div className="flex justify-center px-4 mt-2 pointer-events-none">
          <div className="bg-red-600 text-white text-sm px-4 py-2 rounded-xl shadow-lg max-w-xs text-center">
            {loadError}
          </div>
        </div>
      )}

      <div className="flex-1" />

      {/* Bottom controls */}
      <div className="pointer-events-auto bg-navy/80 backdrop-blur-md rounded-t-2xl px-5 pt-4 pb-safe">
        <div className="flex gap-4 mb-4">
          <div className="flex-1 flex flex-col gap-2.5">
            <div className="flex justify-between">
              <span className="text-white/60 text-xs">Video length</span>
              <span className="text-white font-bold text-xs">{duration}s</span>
            </div>
            <input
              type="range"
              min={5}
              max={30}
              step={1}
              value={duration}
              onChange={e => {
                setDuration(Number(e.target.value));
                // Changing the length restarts from the beginning — resuming with a
                // different duration would visibly jump the playback speed mid-route
                resumeFromRef.current = 0;
              }}
              className="w-full h-2 accent-amber"
              disabled={isPlaying}
            />
          </div>
          <div className="flex-1 flex flex-col gap-2.5">
            <div className="flex justify-between">
              <span className="text-white/60 text-xs">Model size</span>
              <span className="text-white font-bold text-xs">{userScale.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.1}
              value={userScale}
              onChange={e => setUserScale(Number(e.target.value))}
              className="w-full h-2 accent-amber"
            />
          </div>
        </div>

        {/* Camera mode + counter toggles */}
        <div className="flex gap-2 mb-3">
          <div className="flex gap-1 flex-1 bg-white/10 rounded-xl p-1">
            <button
              onClick={() => setCameraMode('static')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${cameraMode === 'static' ? 'bg-amber text-navy' : 'text-white/60'}`}
            >
              🗺 3rd Person
            </button>
            <button
              onClick={() => setCameraMode('pov')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${cameraMode === 'pov' ? 'bg-amber text-navy' : 'text-white/60'}`}
            >
              🎥 1st Person
            </button>
          </div>
          <button
            onClick={() => setShowCounter(c => !c)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95 ${showCounter ? 'bg-red-500/30 text-red-300' : 'bg-white/10 text-white/40'}`}
          >
            📍 km
          </button>
        </div>

        <div className="flex gap-3 mb-1">
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
            onClick={videoReady ? shareVideo : undefined}
            disabled={!videoReady}
            className={[
              'flex-1 py-3 rounded-2xl font-bold text-base transition-all active:scale-95',
              videoReady
                ? 'bg-white/30 text-white'
                : isPlaying
                  ? 'bg-white/20 text-white/60 cursor-not-allowed'
                  : 'bg-white/20 text-white/40 cursor-not-allowed',
            ].join(' ')}
          >
            {!videoReady && isPlaying ? 'Preparing…' : '⬇ Download'}
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
