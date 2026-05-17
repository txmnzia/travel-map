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
      const segments = state.segments.map(seg =>
        seg.fromId === action.id || seg.toId === action.id
          ? recomputeSegment(seg, waypoints)
          : seg,
      );
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

    case 'CLEAR_ALL':
      return EMPTY;

    case 'SET_VEHICLE': {
      const segments = state.segments.map(seg => {
        if (seg.id !== action.segmentId) return seg;
        const updated = { ...seg, vehicle: action.vehicle };
        return recomputeSegment(updated, state.waypoints);
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
    (lng: number, lat: number, defaultVehicle: VehicleType = 'plane') => {
      const waypoint: Waypoint = {
        id: `wp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        lng,
        lat,
      };

      const prev = history.present.waypoints.at(-1);
      let segment: Segment | undefined;

      if (prev) {
        const route = computeRoute([prev.lng, prev.lat], [lng, lat], defaultVehicle, []);
        segment = {
          id: `seg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fromId: prev.id,
          toId: waypoint.id,
          vehicle: defaultVehicle,
          handles: [],
          route,
        };
      }

      dispatch({ type: 'ADD_WAYPOINT', waypoint, segment });
    },
    [history.present.waypoints],
  );

  return {
    state: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    dispatch,
    addWaypoint,
  };
}
