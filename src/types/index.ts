export type VehicleType =
  | 'sedan' | 'suv' | 'sports-car' | 'race-car' | 'taxi' | 'truck' | 'ambulance' | 'firetruck'
  | 'speedboat' | 'sailboat' | 'rowboat' | 'tugboat' | 'fanboat'
  | 'cargo-ship' | 'ocean-liner' | 'pirate-ship'
  | 'locomotive' | 'bullet-train' | 'tram' | 'subway';

export type AppMode = 'edit' | 'preview';
export type MapStyleId = 'bright' | 'liberty' | 'positron';

export interface Waypoint {
  id: string;
  lng: number;
  lat: number;
}

export interface Segment {
  id: string;
  fromId: string;
  toId: string;
  vehicle: VehicleType;
  manualVehicle?: boolean;
  /** User-placed bezier control handles between the two waypoints */
  handles: [number, number][];
  /** Computed polyline coordinates [lng, lat][] */
  route: [number, number][];
}

export interface TravelState {
  waypoints: Waypoint[];
  segments: Segment[];
}

export type TravelAction =
  | { type: 'ADD_WAYPOINT'; waypoint: Waypoint; segment?: Segment }
  | { type: 'MOVE_WAYPOINT'; id: string; lng: number; lat: number }
  | { type: 'REMOVE_LAST_WAYPOINT' }
  | { type: 'CLEAR_ALL' }
  | { type: 'SET_VEHICLE'; segmentId: string; vehicle: VehicleType }
  | { type: 'ADD_HANDLE'; segmentId: string; handle: [number, number] }
  | { type: 'MOVE_HANDLE'; segmentId: string; index: number; handle: [number, number] }
  | { type: 'REMOVE_WAYPOINT'; id: string }
  | { type: 'INSERT_WAYPOINT'; waypoint: Waypoint; segmentId: string }
  | { type: 'UNDO' }
  | { type: 'REDO' };
