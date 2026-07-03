import { describe, expect, it } from 'vitest';
import { computeRoute, interpolateAlong, sliceRoute } from './routing';

describe('computeRoute', () => {
  it('returns a straight line without handles', () => {
    const route = computeRoute([0, 0], [10, 10], 'sedan', []);
    expect(route).toEqual([[0, 0], [10, 10]]);
  });

  it('returns a Bézier polyline through a handle', () => {
    const route = computeRoute([0, 0], [10, 0], 'sedan', [[5, 5]]);
    expect(route.length).toBe(81);
    expect(route[0]).toEqual([0, 0]);
    expect(route[route.length - 1]).toEqual([10, 0]);
    // Quadratic Bézier midpoint = 0.25·A + 0.5·H + 0.25·B
    const mid = route[40];
    expect(mid[0]).toBeCloseTo(5);
    expect(mid[1]).toBeCloseTo(2.5);
  });
});

describe('interpolateAlong', () => {
  const route: [number, number][] = [[0, 0], [1, 0], [2, 0]];

  it('returns start at progress 0 and end at progress 1', () => {
    expect(interpolateAlong(route, 0).position[0]).toBeCloseTo(0);
    expect(interpolateAlong(route, 1).position[0]).toBeCloseTo(2, 2);
  });

  it('points east along an eastbound route', () => {
    expect(interpolateAlong(route, 0.5).bearing).toBeCloseTo(90, 0);
  });

  it('handles degenerate routes', () => {
    expect(interpolateAlong([], 0.5)).toEqual({ position: [0, 0], bearing: 0 });
    expect(interpolateAlong([[3, 4]], 0.5)).toEqual({ position: [3, 4], bearing: 0 });
  });
});

describe('sliceRoute', () => {
  it('returns empty at progress 0 and the full line at 1', () => {
    const route: [number, number][] = [[0, 0], [2, 0]];
    expect(sliceRoute(route, 0)).toEqual([]);
    const full = sliceRoute(route, 1);
    expect(full[full.length - 1][0]).toBeCloseTo(2, 2);
  });
});
