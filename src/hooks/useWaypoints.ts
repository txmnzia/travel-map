import { useReducer, useCallback } from 'react';
import { TravelState, TravelAction, Waypoint, Segment, VehicleType } from '../types';
import { computeRoute } from '../utils/routing';

const MAX_HISTORY = 30;

interface HistoryState {
  past: TravelState[];
  present: TravelState;
  future: TravelState[];
}

const EMPTY: TravelState = { waypoints: [], segments: [] };

function recomputeSegment(
  seg: Segment,
  waypoints: Waypoint[],
): Segment {
  const from = waypoints.find(w => w.id === seg.fromId);
  const to = waypoints.find(w => w.id === seg.toId);
  if (!from || !to) return seg;
  const route = computeRoute(
    [from.lng, from.lat],
    [to.lng, to.lat],
    seg.vehicle,
    seg.handles,
  );
  return { ...seg, route };
}

function travelReducer(state: TravelState, action: TravelAction): TravelState {
  switch (action.type) {
    case 'ADD_WAYPOINT': {
      const waypoints = [...state.waypoints, action.waypoint];
      const segments = action.segment
        ? [...state.segments, action.segment]
        : state.segments;
      return { waypoints, segments };
    }

    case 'MOVE_WAYPOINT': {
      const waypoints = state.waypoints.map(w =>
        w.id === action.id ? { ...w, lng: action.lng, lat: action.lat } : w,
      );
      const segments = state.segments.map(seg => {
        if (seg.fromId !== action.id && seg.toId !== action.id) return seg;
        // Clear stale handles — absolute coords are invalid after endpoint moves
        return recomputeSegment({ ...seg, handles: [] }, waypoints);
      });
      return { waypoints, segments };
    }

    case 'REMOVE_LAST_WAYPOINT': {
      if (state.waypoints.length === 0) return state;
      const waypoints = state.waypoints.slice(0, -1);
      const lastId = state.waypoints[state.waypoints.length - 1].id;
      const segments = state.segments.filter(
        s => s.fromId !== lastId && s.toId !== lastId,
      );
      return { waypoints, segments };
    }

    case 'REMOVE_WAYPOINT': {
      const idx = state.waypoints.findIndex(w => w.id === action.id);
      if (idx === -1) return state;

      const incoming = state.segments.find(s => s.toId === action.id);
      const outgoing = state.segments.find(s => s.fromId === action.id);

      const waypoints = state.waypoints.filter(w => w.id !== action.id);
      let segments = state.segments.filter(
        s => s.fromId !== action.id && s.toId !== action.id,
      );

      // Reconnect the two neighbours if this was a middle point
      if (incoming && outgoing) {
        const fromWp = state.waypoints.find(w => w.id === incoming.fromId)!;
        const toWp = state.waypoints.find(w => w.id === outgoing.toId)!;
        const newSeg: Segment = {
          id: `seg-${Date.now()}`,
          fromId: fromWp.id,
          toId: toWp.id,
          vehicle: outgoing.vehicle,
          manualVehicle: false,
          handles: [],
          route: computeRoute(
            [fromWp.lng, fromWp.lat],
            [toWp.lng, toWp.lat],
            outgoing.vehicle,
            [],
          ),
        };
        const incomingIdx = state.segments.findIndex(s => s.id === incoming.id);
        segments = [
          ...segments.slice(0, incomingIdx),
          newSeg,
          ...segments.slice(incomingIdx),
        ];
      }

      return { waypoints, segments };
    }

    case 'INSERT_WAYPOINT': {
      const seg = state.segments.find(s => s.id === action.segmentId);
      if (!seg) return state;

      const fromIdx = state.waypoints.findIndex(w => w.id === seg.fromId);
      const toWp = state.waypoints.find(w => w.id === seg.toId);
      if (fromIdx === -1 || !toWp) return state;

      const fromWp = state.waypoints[fromIdx];
      const { waypoint } = action;

      // Insert new waypoint between fromWp and toWp
      const waypoints = [
        ...state.waypoints.slice(0, fromIdx + 1),
        waypoint,
        ...state.waypoints.slice(fromIdx + 1),
      ];

      const seg1: Segment = {
        id: `seg-${Date.now()}-a`,
        fromId: fromWp.id,
        toId: waypoint.id,
        vehicle: seg.vehicle,
        manualVehicle: false,
        handles: [],
        route: computeRoute([fromWp.lng, fromWp.lat], [waypoint.lng, waypoint.lat], seg.vehicle, []),
      };
      const seg2: Segment = {
        id: `seg-${Date.now()}-b`,
        fromId: waypoint.id,
        toId: toWp.id,
        vehicle: seg.vehicle,
        manualVehicle: false,
        handles: [],
        route: computeRoute([waypoint.lng, waypoint.lat], [toWp.lng, toWp.lat], seg.vehicle, []),
      };

      const segIdx = state.segments.findIndex(s => s.id === action.segmentId);
      const segments = [
        ...state.segments.slice(0, segIdx),
        seg1,
        seg2,
        ...state.segments.slice(segIdx + 1),
      ];

      return { waypoints, segments };
    }

    case 'CLEAR_ALL':
      return EMPTY;

    case 'SET_VEHICLE': {
      const idx = state.segments.findIndex(s => s.id === action.segmentId);
      if (idx === -1) return state;

      let blocked = false;
      const segments = state.segments.map((seg, i) => {
        if (i < idx) return seg;
        if (i === idx) {
          return recomputeSegment({ ...seg, vehicle: action.vehicle, manualVehicle: true }, state.waypoints);
        }
        // Propagate forward until hitting a manually-set segment
        if (blocked || seg.manualVehicle) { blocked = true; return seg; }
        return recomputeSegment({ ...seg, vehicle: action.vehicle }, state.waypoints);
      });
      return { ...state, segments };
    }

    case 'ADD_HANDLE': {
      const segments = state.segments.map(seg => {
        if (seg.id !== action.segmentId) return seg;
        const handles = [...seg.handles, action.handle];
        const updated = { ...seg, handles };
        return recomputeSegment(updated, state.waypoints);
      });
      return { ...state, segments };
    }

    case 'MOVE_HANDLE': {
      const segments = state.segments.map(seg => {
        if (seg.id !== action.segmentId) return seg;
        const handles = seg.handles.map((h, i) =>
          i === action.index ? action.handle : h,
        );
        const updated = { ...seg, handles };
        return recomputeSegment(updated, state.waypoints);
      });
      return { ...state, segments };
    }

    default:
      return state;
  }
}

function historyReducer(state: HistoryState, action: TravelAction): HistoryState {
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1];
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
    };
  }
  if (action.type === 'REDO') {
    if (state.future.length === 0) return state;
    const next = state.future[0];
    return {
      past: [...state.past, state.present].slice(-MAX_HISTORY),
      present: next,
      future: state.future.slice(1),
    };
  }

  const next = travelReducer(state.present, action);
  if (next === state.present) return state;
  return {
    past: [...state.past, state.present].slice(-MAX_HISTORY),
    present: next,
    future: [],
  };
}

export function useWaypoints() {
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: EMPTY,
    future: [],
  });

  const addWaypoint = useCallback(
    (lng: number, lat: number) => {
      const waypoint: Waypoint = {
        id: `wp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        lng,
        lat,
      };

      const prev = history.present.waypoints.at(-1);
      let segment: Segment | undefined;

      if (prev) {
        // Inherit the last segment's vehicle so the route type stays consistent
        const vehicle = history.present.segments.at(-1)?.vehicle ?? 'sedan';
        const route = computeRoute([prev.lng, prev.lat], [lng, lat], vehicle, []);
        segment = {
          id: `seg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fromId: prev.id,
          toId: waypoint.id,
          vehicle,
          manualVehicle: false,
          handles: [],
          route,
        };
      }

      dispatch({ type: 'ADD_WAYPOINT', waypoint, segment });
    },
    [history.present.waypoints, history.present.segments],
  );

  return {
    state: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    dispatch,
    addWaypoint,
  };
}
