export type AppMode = 'edit' | 'preview';
export type MapStyleId = 'bright' | 'liberty' | 'positron';

export type VehicleType =
  // Cars & road
  | 'sedan' | 'suv' | 'sports-car' | 'race-car' | 'taxi' | 'truck' | 'ambulance' | 'firetruck'
  // Boats
  | 'speedboat' | 'sailboat' | 'rowboat' | 'tugboat' | 'fanboat'
  // Ships
  | 'cargo-ship' | 'ocean-liner' | 'pirate-ship'
  // Rail
  | 'locomotive' | 'bullet-train' | 'tram' | 'subway';

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
  /** True when the user explicitly chose this vehicle (blocks forward propagation) */
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
