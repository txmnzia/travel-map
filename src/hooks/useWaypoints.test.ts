import { describe, expect, it } from 'vitest';
import { historyReducer, travelReducer, HistoryState } from './useWaypoints';
import { Segment, TravelState, Waypoint } from '../types';

function wp(id: string, lng: number, lat: number): Waypoint {
  return { id, lng, lat };
}

function seg(id: string, fromId: string, toId: string, extra: Partial<Segment> = {}): Segment {
  return {
    id,
    fromId,
    toId,
    vehicle: 'sedan',
    manualVehicle: false,
    color: null,
    handles: [],
    route: [[0, 0], [1, 1]],
    ...extra,
  };
}

/** Three waypoints A→B→C with two segments. */
function threePointState(): TravelState {
  return {
    waypoints: [wp('a', 0, 0), wp('b', 1, 0), wp('c', 2, 0)],
    segments: [
      seg('s1', 'a', 'b', { route: [[0, 0], [1, 0]] }),
      seg('s2', 'b', 'c', { route: [[1, 0], [2, 0]] }),
    ],
  };
}

describe('travelReducer SET_VEHICLE', () => {
  it('sets vehicle and color atomically and propagates both forward', () => {
    const next = travelReducer(threePointState(), {
      type: 'SET_VEHICLE', segmentId: 's1', vehicle: 'speedboat', color: '#ef4444',
    });
    expect(next.segments[0].vehicle).toBe('speedboat');
    expect(next.segments[0].color).toBe('#ef4444');
    expect(next.segments[0].manualVehicle).toBe(true);
    // propagated to the following non-manual segment
    expect(next.segments[1].vehicle).toBe('speedboat');
    expect(next.segments[1].color).toBe('#ef4444');
    expect(next.segments[1].manualVehicle).toBe(false);
  });

  it('stops propagation at a manually-set segment', () => {
    const state = threePointState();
    state.segments[1] = { ...state.segments[1], manualVehicle: true, vehicle: 'tram' };
    const next = travelReducer(state, {
      type: 'SET_VEHICLE', segmentId: 's1', vehicle: 'suv', color: null,
    });
    expect(next.segments[0].vehicle).toBe('suv');
    expect(next.segments[1].vehicle).toBe('tram');
  });
});

describe('travelReducer REMOVE_WAYPOINT', () => {
  it('reconnects neighbours and keeps the outgoing segment settings', () => {
    const state = threePointState();
    state.segments[1] = {
      ...state.segments[1], vehicle: 'sailboat', color: '#3b82f6', manualVehicle: true,
    };
    const next = travelReducer(state, { type: 'REMOVE_WAYPOINT', id: 'b' });
    expect(next.waypoints.map(w => w.id)).toEqual(['a', 'c']);
    expect(next.segments).toHaveLength(1);
    const joined = next.segments[0];
    expect(joined.fromId).toBe('a');
    expect(joined.toId).toBe('c');
    expect(joined.vehicle).toBe('sailboat');
    expect(joined.color).toBe('#3b82f6');
    expect(joined.manualVehicle).toBe(true);
  });

  it('removes an endpoint without reconnecting', () => {
    const next = travelReducer(threePointState(), { type: 'REMOVE_WAYPOINT', id: 'c' });
    expect(next.waypoints.map(w => w.id)).toEqual(['a', 'b']);
    expect(next.segments.map(s => s.id)).toEqual(['s1']);
  });
});

describe('travelReducer INSERT_WAYPOINT', () => {
  it('splits a segment, inheriting vehicle/color/manual flag on both halves', () => {
    const state = threePointState();
    state.segments[0] = {
      ...state.segments[0], vehicle: 'taxi', color: '#fbbf24', manualVehicle: true,
    };
    const next = travelReducer(state, {
      type: 'INSERT_WAYPOINT', waypoint: wp('m', 0.5, 0), segmentId: 's1',
    });
    expect(next.waypoints.map(w => w.id)).toEqual(['a', 'm', 'b', 'c']);
    expect(next.segments).toHaveLength(3);
    for (const half of next.segments.slice(0, 2)) {
      expect(half.vehicle).toBe('taxi');
      expect(half.color).toBe('#fbbf24');
      expect(half.manualVehicle).toBe(true);
      expect(half.handles).toEqual([]);
    }
    expect(next.segments[0].fromId).toBe('a');
    expect(next.segments[0].toId).toBe('m');
    expect(next.segments[1].fromId).toBe('m');
    expect(next.segments[1].toId).toBe('b');
  });
});

describe('historyReducer undo/redo', () => {
  const empty: HistoryState = {
    past: [],
    present: { waypoints: [], segments: [] },
    future: [],
  };

  it('one SET_VEHICLE action = one undo entry', () => {
    let h: HistoryState = { ...empty, present: threePointState() };
    h = historyReducer(h, { type: 'SET_VEHICLE', segmentId: 's1', vehicle: 'suv', color: '#22c55e' });
    expect(h.past).toHaveLength(1);
    expect(h.present.segments[0].vehicle).toBe('suv');

    h = historyReducer(h, { type: 'UNDO' });
    expect(h.present.segments[0].vehicle).toBe('sedan');
    expect(h.present.segments[0].color).toBe(null);
    expect(h.future).toHaveLength(1);
  });

  it('redo restores the undone state', () => {
    let h: HistoryState = { ...empty, present: threePointState() };
    h = historyReducer(h, { type: 'SET_VEHICLE', segmentId: 's1', vehicle: 'suv', color: null });
    h = historyReducer(h, { type: 'UNDO' });
    h = historyReducer(h, { type: 'REDO' });
    expect(h.present.segments[0].vehicle).toBe('suv');
    expect(h.future).toHaveLength(0);
  });

  it('no-op actions do not pollute history', () => {
    let h: HistoryState = { ...empty, present: threePointState() };
    h = historyReducer(h, { type: 'SET_VEHICLE', segmentId: 'missing', vehicle: 'suv', color: null });
    expect(h.past).toHaveLength(0);
  });

  it('caps history at 30 entries', () => {
    let h: HistoryState = empty;
    for (let i = 0; i < 40; i++) {
      h = historyReducer(h, {
        type: 'ADD_WAYPOINT', waypoint: wp(`w${i}`, i, 0),
      });
    }
    expect(h.past.length).toBe(30);
  });
});
