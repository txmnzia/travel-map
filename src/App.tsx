import { useState, useRef, useEffect, useCallback } from 'react';
import { MapEditor, MapEditorHandle } from './components/MapEditor';
import { AnimationPlayer } from './components/AnimationPlayer';
import { VehicleSelector } from './components/VehicleSelector';
import { MapStylePicker } from './components/MapStylePicker';
import { MenuDrawer } from './components/MenuDrawer';
import { Toolbar } from './components/Toolbar';
import { useWaypoints } from './hooks/useWaypoints';
import { AppMode, MapStyleId, VehicleType } from './types';

export default function App() {
  const mapEditorRef = useRef<MapEditorHandle>(null);
  const { state, dispatch, addWaypoint, canUndo, canRedo } = useWaypoints();

  const [mode, setMode] = useState<AppMode>('edit');
  const [mapStyle, setMapStyle] = useState<MapStyleId>('bright');
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const [vehicleSelector, setVehicleSelector] = useState<{
    segmentId: string;
    vehicle: VehicleType;
  } | null>(null);

  // Listen for open-vehicle-selector events from marker elements
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { segmentId: string; vehicle: VehicleType };
      setVehicleSelector(detail);
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

      {/* UI hidden for diagnostic — testing map-only full-screen */}
    </div>
  );
}
