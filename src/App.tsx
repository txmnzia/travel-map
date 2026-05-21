import { useState, useRef, useEffect, useCallback } from 'react';
import { MapEditor, MapEditorHandle } from './components/MapEditor';
import { AnimationPlayer } from './components/AnimationPlayer';
import { VehicleSelector } from './components/VehicleSelector';
import { MapStylePicker } from './components/MapStylePicker';
import { Toolbar } from './components/Toolbar';
import { useWaypoints } from './hooks/useWaypoints';
import { parseGpx } from './utils/gpx';
import { AppMode, MapStyleId, VehicleType } from './types';

export default function App() {
  const mapEditorRef = useRef<MapEditorHandle>(null);
  const { state, dispatch, addWaypoint, canUndo, canRedo } = useWaypoints();

  const [mode, setMode] = useState<AppMode>('edit');
  const [mapStyle, setMapStyle] = useState<MapStyleId>('bright');
  const [showStylePicker, setShowStylePicker] = useState(false);

  const [vehicleSelector, setVehicleSelector] = useState<{
    segmentId: string;
    vehicle: VehicleType;
    color: string | null;
    animation: string | null;
  } | null>(null);

  // Listen for open-vehicle-selector events from marker elements
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { segmentId: string; vehicle: VehicleType; color?: string | null; animation?: string | null };
      setVehicleSelector({ segmentId: detail.segmentId, vehicle: detail.vehicle, color: detail.color ?? null, animation: detail.animation ?? null });
    };
    document.addEventListener('open-vehicle-selector', handler);
    return () => document.removeEventListener('open-vehicle-selector', handler);
  }, []);

  // Listen for remove-waypoint events from marker elements
  useEffect(() => {
    const handler = (e: Event) => {
      const { waypointId } = (e as CustomEvent).detail as { waypointId: string };
      dispatch({ type: 'REMOVE_WAYPOINT', id: waypointId });
    };
    document.addEventListener('remove-waypoint', handler);
    return () => document.removeEventListener('remove-waypoint', handler);
  }, [dispatch]);

  const handleAddWaypoint = useCallback(
    (lng: number, lat: number) => {
      addWaypoint(lng, lat);
    },
    [addWaypoint],
  );

  const [gpxError, setGpxError] = useState<string | null>(null);

  const handleGpxImport = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const result = parseGpx(text);
        if (!result) {
          setGpxError('Could not read GPX file. Make sure it contains track or route points.');
          setTimeout(() => setGpxError(null), 4000);
          return;
        }
        dispatch({ type: 'IMPORT_ROUTE', waypoints: result.waypoints, segments: result.segments });
        const map = mapEditorRef.current?.getMap();
        if (map) {
          map.fitBounds(result.bounds, { padding: 60, duration: 800 });
        }
      };
      reader.readAsText(file);
    },
    [dispatch],
  );

  const enterPreview = () => {
    if (state.waypoints.length < 2) return;
    setMode('preview');
  };

  const exitPreview = () => {
    setMode('edit');
  };

  const map = mapEditorRef.current?.getMap() ?? null;

  return (
    <div className="absolute inset-0 bg-navy">

      {/* Map (always mounted) */}
      <MapEditor
        ref={mapEditorRef}
        state={state}
        dispatch={dispatch}
        addWaypoint={handleAddWaypoint}
        mapStyle={mapStyle}
        visible={mode === 'edit'}
      />

      {/* Edit mode overlays */}
      {mode === 'edit' && (
        <>
          {/* Bottom toolbar */}
          <Toolbar
            canUndo={canUndo}
            waypointCount={state.waypoints.length}
            onUndo={() => dispatch({ type: 'UNDO' })}
            onPlay={enterPreview}
            onClear={() => dispatch({ type: 'CLEAR_ALL' })}
            onStylePicker={() => setShowStylePicker(true)}
            onImport={handleGpxImport}
          />

          {/* GPX import error toast */}
          {gpxError && (
            <div className="absolute top-4 left-4 right-4 z-[80] flex justify-center pointer-events-none">
              <div className="bg-red-600 text-white text-sm px-4 py-2 rounded-xl shadow-lg max-w-xs text-center">
                {gpxError}
              </div>
            </div>
          )}

          {/* Vehicle selector bottom sheet */}
          {vehicleSelector && (
            <VehicleSelector
              segmentId={vehicleSelector.segmentId}
              current={vehicleSelector.vehicle}
              currentColor={vehicleSelector.color}
              currentAnimation={vehicleSelector.animation}
              onSelect={(segmentId, vehicle, color, animation) => {
                dispatch({ type: 'SET_VEHICLE', segmentId, vehicle });
                dispatch({ type: 'SET_COLOR', segmentId, color });
                dispatch({ type: 'SET_ANIMATION', segmentId, animation: animation ?? null });
              }}
              onClose={() => setVehicleSelector(null)}
            />
          )}

          {/* Map style picker */}
          {showStylePicker && (
            <MapStylePicker
              current={mapStyle}
              onChange={setMapStyle}
              onClose={() => setShowStylePicker(false)}
            />
          )}


        </>
      )}

      {/* Preview mode overlays */}
      {mode === 'preview' && (
        <AnimationPlayer
          map={map}
          state={state}
          onBack={exitPreview}
        />
      )}
    </div>
  );
}
