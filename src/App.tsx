import { useState, useRef, useEffect, useCallback } from 'react';
import { MapEditor, MapEditorHandle } from './components/MapEditor';
import { AnimationPlayer } from './components/AnimationPlayer';
import { VehicleSelector } from './components/VehicleSelector';
import { MapStylePicker } from './components/MapStylePicker';
import { Toolbar } from './components/Toolbar';
import { useWaypoints } from './hooks/useWaypoints';
import { AppMode, MapStyleId, VehicleType } from './types';

export default function App() {
  const mapEditorRef = useRef<MapEditorHandle>(null);
  const { state, dispatch, addWaypoint, canUndo, canRedo } = useWaypoints();

  const [mode, setMode] = useState<AppMode>('edit');
  const [mapStyle, setMapStyle] = useState<MapStyleId>('bright');
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [vehicleSelector, setVehicleSelector] = useState<{
    segmentId: string;
    vehicle: VehicleType;
  } | null>(null);

  const handleAddWaypoint = useCallback(
    (lng: number, lat: number) => {
      addWaypoint(lng, lat);
    },
    [addWaypoint],
  );

  // Listen for open-vehicle-selector events from marker elements
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { segmentId: string; vehicle: VehicleType };
      setVehicleSelector(detail);
    };
    document.addEventListener('open-vehicle-selector', handler);
    return () => document.removeEventListener('open-vehicle-selector', handler);
  }, []);

  const enterPreview = () => {
    if (state.waypoints.length < 2) return;
    setMode('preview');
  };

  const exitPreview = () => {
    setMode('edit');
  };

  const map = mapEditorRef.current?.getMap() ?? null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-navy">
      {/* Header */}
      {mode === 'edit' && (
        <div className="absolute top-0 left-0 right-0 z-10 bg-navy pt-safe">
          <div className="flex items-center justify-between px-4 py-3">
            <button className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white text-lg shadow">
              ☰
            </button>
            <h1 className="text-white font-black text-xl tracking-widest uppercase">
              Draw a Route
            </h1>
            <div className="w-10" />
          </div>
        </div>
      )}

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
          {/* Hint when no waypoints — outer div is pointer-events-none so the map
              remains tappable; inner card is pointer-events-auto so clicking it
              dismisses the hint without placing a waypoint. */}
          {state.waypoints.length === 0 && !hintDismissed && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3 pointer-events-none px-8 z-10">
              <div
                className="bg-navy/80 backdrop-blur-sm rounded-2xl px-6 py-4 text-center pointer-events-auto cursor-pointer select-none"
                onClick={() => setHintDismissed(true)}
              >
                <p className="text-white font-bold text-lg mb-1">Tap the map</p>
                <p className="text-white/60 text-sm">
                  to place your first waypoint
                </p>
                <p className="text-white/30 text-xs mt-2">Tap here to dismiss</p>
              </div>
            </div>
          )}

          {/* Bottom toolbar */}
          <Toolbar
            canUndo={canUndo}
            canRedo={canRedo}
            hasWaypoints={state.waypoints.length >= 2}
            onUndo={() => dispatch({ type: 'UNDO' })}
            onRedo={() => dispatch({ type: 'REDO' })}
            onPlay={enterPreview}
            onClear={() => dispatch({ type: 'CLEAR_ALL' })}
            onStylePicker={() => setShowStylePicker(true)}
          />

          {/* Vehicle selector bottom sheet */}
          {vehicleSelector && (
            <VehicleSelector
              segmentId={vehicleSelector.segmentId}
              current={vehicleSelector.vehicle}
              onSelect={(segmentId, vehicle) =>
                dispatch({ type: 'SET_VEHICLE', segmentId, vehicle })
              }
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
