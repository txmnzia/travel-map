import { lineString, point } from '@turf/helpers';
import { length } from '@turf/length';
import { along } from '@turf/along';
import { lineSliceAlong } from '@turf/line-slice-along';
import { bearing as turfBearing } from '@turf/bearing';
import { distance } from '@turf/distance';
import { greatCircle } from '@turf/great-circle';
import { VehicleType } from '../types';
import { getVehicle } from './vehicles';

/**
 * Compute a curved polyline for a segment.
 * - Any vehicle with handles: quadratic/cubic Bezier through the handles
 * - Boats on long crossings: great-circle arc
 * - Others: straight line
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
  // Boats follow great circles on long crossings — a straight lng/lat chord
  // across an ocean looks wrong on the projected map
  if (
    getVehicle(vehicle).category === 'Boats' &&
    distance(point(from), point(to), { units: 'kilometers' }) > 300
  ) {
    return greatCircleArc(from, to);
  }
  return [from, to];
}

export function greatCircleArc(from: [number, number], to: [number, number]): [number, number][] {
  try {
    const gc = greatCircle(point(from), point(to), { npoints: 80 });
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

  const line = lineString(route);
  const total = length(line, { units: 'kilometers' });
  const dist = Math.min(progress, 0.9999) * total;

  const pt = along(line, dist, { units: 'kilometers' });
  const pos = pt.geometry.coordinates as [number, number];

  // Bearing: look slightly ahead for smooth rotation
  const aheadDist = Math.min(dist + total * 0.01, total * 0.9999);
  const ahead = along(line, aheadDist, { units: 'kilometers' });
  const bearing = turfBearing(pt, ahead);

  return { position: pos, bearing };
}

/** Slice route from start to progress 0..1 (for the trail). */
export function sliceRoute(
  route: [number, number][],
  progress: number,
): [number, number][] {
  if (route.length < 2 || progress <= 0) return [];
  const line = lineString(route);
  const total = length(line, { units: 'kilometers' });
  const dist = Math.min(progress, 0.9999) * total;
  const sliced = lineSliceAlong(line, 0, dist, { units: 'kilometers' });
  return sliced.geometry.coordinates as [number, number][];
}

/**
 * Precomputed cumulative-distance lookup along a route.
 *
 * interpolateAlong/sliceRoute re-measure the whole polyline with turf on every
 * call, which the animation loop (and each train wagon) does per frame. This
 * class measures once and answers position/bearing/slice queries with a binary
 * search plus linear interpolation between adjacent vertices — visually
 * identical on the densely-sampled polylines the app produces.
 */
export class RouteSampler {
  readonly route: [number, number][];
  readonly totalKm: number;
  private readonly cum: number[]; // cumulative km at each vertex

  constructor(route: [number, number][]) {
    this.route = route;
    this.cum = new Array(route.length).fill(0);
    let acc = 0;
    for (let i = 1; i < route.length; i++) {
      acc += distance(point(route[i - 1]), point(route[i]), { units: 'kilometers' });
      this.cum[i] = acc;
    }
    this.totalKm = acc;
  }

  /** Index of the last vertex at or before `dist` km. */
  private seek(dist: number): number {
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= dist) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private positionAt(dist: number): [number, number] {
    const r = this.route;
    if (r.length < 2 || this.totalKm === 0) return r[0] ?? [0, 0];
    const d = Math.max(0, Math.min(dist, this.totalKm));
    const i = Math.min(this.seek(d), r.length - 2);
    const segLen = this.cum[i + 1] - this.cum[i];
    const t = segLen > 0 ? (d - this.cum[i]) / segLen : 0;
    return [
      r[i][0] + (r[i + 1][0] - r[i][0]) * t,
      r[i][1] + (r[i + 1][1] - r[i][1]) * t,
    ];
  }

  /** Position + look-ahead bearing at progress 0..1. */
  at(progress: number): { position: [number, number]; bearing: number } {
    if (this.route.length < 2) return { position: this.route[0] ?? [0, 0], bearing: 0 };
    const dist = Math.min(progress, 0.9999) * this.totalKm;
    const pos = this.positionAt(dist);
    const ahead = this.positionAt(Math.min(dist + this.totalKm * 0.01, this.totalKm * 0.9999));
    const bearing = turfBearing(point(pos), point(ahead));
    return { position: pos, bearing };
  }

  /** Route slice from start to progress 0..1 (for the trail). */
  slice(progress: number): [number, number][] {
    if (this.route.length < 2 || progress <= 0) return [];
    const dist = Math.min(progress, 0.9999) * this.totalKm;
    const i = Math.min(this.seek(dist), this.route.length - 2);
    const result = this.route.slice(0, i + 1);
    result.push(this.positionAt(dist));
    return result;
  }
}
