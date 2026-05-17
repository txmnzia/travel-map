import * as turf from '@turf/turf';
import { VehicleType } from '../types';

/**
 * Compute a curved polyline for a segment.
 * - Plane with no handles: great-circle arc
 * - Any vehicle with handles: quadratic/cubic Bezier through the handles
 * - Others with no handles: straight line
 */
export function computeRoute(
  from: [number, number],
  to: [number, number],
  vehicle: VehicleType,
  handles: [number, number][],
): [number, number][] {
  if (handles.length > 0) {
    return bezierCurve(from, handles, to, 80);
  }

  if (vehicle === 'plane') {
    return greatCircleArc(from, to);
  }

  // Straight line for all other vehicles (no road-snapping)
  return [from, to];
}

function greatCircleArc(from: [number, number], to: [number, number]): [number, number][] {
  try {
    const gc = turf.greatCircle(turf.point(from), turf.point(to), { npoints: 80 });
    const geom = gc.geometry;
    if (geom.type === 'LineString') {
      return geom.coordinates as [number, number][];
    }
    // Crosses antimeridian → MultiLineString; take first segment
    if (geom.type === 'MultiLineString') {
      return geom.coordinates[0] as [number, number][];
    }
    return [from, to];
  } catch {
    return [from, to];
  }
}

/**
 * General Bezier curve through control points.
 * Uses De Casteljau algorithm for any degree.
 */
function bezierCurve(
  from: [number, number],
  handles: [number, number][],
  to: [number, number],
  steps: number,
): [number, number][] {
  const pts: [number, number][] = [from, ...handles, to];
  const result: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    result.push(deCasteljau(pts, t));
  }
  return result;
}

function deCasteljau(pts: [number, number][], t: number): [number, number] {
  let p = pts.slice();
  while (p.length > 1) {
    const next: [number, number][] = [];
    for (let i = 0; i < p.length - 1; i++) {
      next.push([
        (1 - t) * p[i][0] + t * p[i + 1][0],
        (1 - t) * p[i][1] + t * p[i + 1][1],
      ]);
    }
    p = next;
  }
  return p[0];
}

/** Return the midpoint [lng, lat] of a route polyline. */
export function routeMidpoint(route: [number, number][]): [number, number] {
  if (route.length === 0) return [0, 0];
  const mid = Math.floor(route.length / 2);
  return route[mid];
}

/** Interpolate a position along a route given progress 0..1. */
export function interpolateAlong(
  route: [number, number][],
  progress: number,
): { position: [number, number]; bearing: number } {
  if (route.length < 2) return { position: route[0] ?? [0, 0], bearing: 0 };

  const line = turf.lineString(route);
  const total = turf.length(line, { units: 'kilometers' });
  const dist = Math.min(progress, 0.9999) * total;

  const pt = turf.along(line, dist, { units: 'kilometers' });
  const pos = pt.geometry.coordinates as [number, number];

  // Bearing: look slightly ahead for smooth rotation
  const aheadDist = Math.min(dist + total * 0.01, total * 0.9999);
  const ahead = turf.along(line, aheadDist, { units: 'kilometers' });
  const bearing = turf.bearing(pt, ahead);

  return { position: pos, bearing };
}

/** Slice route from start to progress 0..1 (for the trail). */
export function sliceRoute(
  route: [number, number][],
  progress: number,
): [number, number][] {
  if (route.length < 2 || progress <= 0) return [];
  const line = turf.lineString(route);
  const total = turf.length(line, { units: 'kilometers' });
  const dist = Math.min(progress, 0.9999) * total;
  const sliced = turf.lineSliceAlong(line, 0, dist, { units: 'kilometers' });
  return sliced.geometry.coordinates as [number, number][];
}
