/**
 * Arc geometry: a pair of coordinates → a flat screen-space polyline.
 *
 * This is the precompute that makes the Canvas renderer fast. It runs **once per
 * threat per layout**, never per frame — the render loop only walks the buffers
 * this produces. See DECISIONS.md §2.
 *
 * @packageDocumentation
 */

import { geoInterpolate } from 'd3-geo';

import type { GeoProjectionLike, LatLng } from '../types.js';

/** A threat's arc, flattened and ready to draw. */
export interface ArcGeometry {
  /**
   * Screen-space points as a flat `[x0, y0, x1, y1, ...]` buffer.
   *
   * Flat and typed rather than `{x, y}[]`: a 500-threat map holds ~25k points,
   * and an array of objects there means 25k allocations the GC must trace on
   * every layout change. A `Float32Array` is one allocation.
   */
  readonly points: Float32Array;
  /**
   * Index at which the polyline breaks, or `-1` if it is continuous.
   *
   * A geodesic that crosses the antimeridian projects into two pieces on
   * opposite edges of the map. Drawing straight through would streak a line
   * across the entire viewport. Everything from this index on belongs to the
   * second piece.
   */
  readonly breakAt: number;
  /** Cumulative arc length at each point, for even-speed head travel. Same length as the point count. */
  readonly distances: Float32Array;
  /** Total polyline length in pixels. */
  readonly length: number;
}

/**
 * Build a threat's arc.
 *
 * Two things make this non-trivial, and both are why we do not simply draw a
 * bezier between two projected points:
 *
 * 1. **Geodesic, not screen-straight.** A straight screen line between Tokyo and
 *    Los Angeles cuts through the projection in a way that is geographically
 *    wrong. Sampling the great circle with `geoInterpolate` and projecting each
 *    sample follows the path an attack would actually take, and curves naturally
 *    under any projection.
 * 2. **The lift is applied in screen space.** After projecting the geodesic, each
 *    sample is pushed perpendicular to the chord by a sine-weighted offset — zero
 *    at both ends, maximal at the middle. Doing this in screen space (rather than
 *    by inflating latitude) keeps the arc height visually consistent regardless
 *    of where on the map the threat is, which is what a threat map wants.
 *
 * @param from - Origin in degrees.
 * @param to - Destination in degrees.
 * @param projection - The active projection.
 * @param curvature - Arc height as a fraction of chord length. `0` is flat.
 * @param segments - Number of straight pieces to flatten into. Higher is smoother.
 * @param maxLift - Ceiling on arc height in pixels. See {@link ArcGeometry} notes:
 *   lift is proportional to chord length, so an intercontinental arc would
 *   otherwise bulge a third of the way off the top of the map and be clipped.
 *   Omit for no cap.
 * @returns Geometry ready for the render loop, or `null` if the arc is not
 *   drawable — either endpoint may be unprojectable (behind an orthographic
 *   globe, say), in which case there is nothing meaningful to render.
 */
export function buildArc(
  from: LatLng,
  to: LatLng,
  projection: GeoProjectionLike,
  curvature: number,
  segments: number,
  maxLift = Infinity,
): ArcGeometry | null {
  const steps = Math.max(2, Math.floor(segments));
  const count = steps + 1;

  const a: [number, number] = [from.lng, from.lat];
  const b: [number, number] = [to.lng, to.lat];

  const startPx = projection(a);
  const endPx = projection(b);
  if (!startPx || !endPx || !isFinitePoint(startPx) || !isFinitePoint(endPx)) return null;

  // Perpendicular to the chord, normalized. The lift is applied along this.
  const dx = endPx[0] - startPx[0];
  const dy = endPx[1] - startPx[1];
  const chord = Math.hypot(dx, dy);
  const nx = chord > 0 ? -dy / chord : 0;
  const ny = chord > 0 ? dx / chord : 0;

  // Lift is proportional to chord length, which reads naturally for regional
  // arcs but not for intercontinental ones: a chord spanning half the map lifts
  // ~180 px at the default curvature, which on a 520 px-tall map leaves the
  // viewport and gets clipped flat against the top edge. The cap keeps long arcs
  // on the map while leaving short ones exactly as curvature specifies.
  const rawLift = chord * curvature;
  const lift = Math.sign(rawLift) * Math.min(Math.abs(rawLift), maxLift);

  const interpolate = geoInterpolate(a, b);
  const points = new Float32Array(count * 2);

  let breakAt = -1;
  let prevX = 0;
  let written = 0;

  for (let i = 0; i < count; i++) {
    const t = i / steps;
    const projected = projection(interpolate(t));

    if (!projected || !isFinitePoint(projected)) {
      // Unprojectable sample (e.g. the far side of an orthographic globe).
      // Degrade to the straight chord rather than dropping the whole threat.
      const x = startPx[0] + dx * t;
      const y = startPx[1] + dy * t;
      points[i * 2] = x;
      points[i * 2 + 1] = y;
      prevX = x;
      written++;
      continue;
    }

    // sin(pi*t) peaks at 1 in the middle and is 0 at both ends, so the arc
    // always meets its endpoints exactly.
    const offset = Math.sin(Math.PI * t) * lift;
    const x = projected[0] + nx * offset;
    const y = projected[1] + ny * offset;

    // A jump this large between adjacent samples of a smooth geodesic means the
    // projection wrapped, not that the path really moved. Record the seam.
    if (written > 0 && breakAt === -1 && Math.abs(x - prevX) > ANTIMERIDIAN_JUMP) {
      breakAt = i;
    }

    points[i * 2] = x;
    points[i * 2 + 1] = y;
    prevX = x;
    written++;
  }

  const { distances, length } = measure(points, count, breakAt);
  return { points, breakAt, distances, length };
}

/**
 * Pixel gap between consecutive samples that indicates a projection wrap.
 *
 * A geodesic sampled at ~48 steps moves at most a few dozen pixels per step on a
 * world map of any sane size; an antimeridian wrap moves nearly the full width.
 * Anything past this is a wrap.
 */
const ANTIMERIDIAN_JUMP = 180;

function isFinitePoint(p: [number, number]): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/**
 * Cumulative distance along the polyline.
 *
 * The head moves at a constant *pixel* speed rather than a constant index step:
 * a projected geodesic bunches its samples where the projection compresses, so
 * stepping by index makes the head visibly lurch. Walking cumulative distance
 * instead keeps it even.
 *
 * The seam segment contributes zero length — the head should not spend time
 * traversing a gap that is not really there.
 */
function measure(points: Float32Array, count: number, breakAt: number): { distances: Float32Array; length: number } {
  const distances = new Float32Array(count);
  let total = 0;

  for (let i = 1; i < count; i++) {
    if (i !== breakAt) {
      const dx = (points[i * 2] as number) - (points[(i - 1) * 2] as number);
      const dy = (points[i * 2 + 1] as number) - (points[(i - 1) * 2 + 1] as number);
      total += Math.hypot(dx, dy);
    }
    distances[i] = total;
  }

  return { distances, length: total };
}

/**
 * Position along the arc at progress `t`, written into `out`.
 *
 * Interpolates by pixel distance, so the head keeps an even pace. Writes into a
 * caller-owned array rather than returning a new one — this runs for every
 * threat on every frame, and returning `{x, y}` there would allocate ~30k
 * objects per second at 500 threats and hand the GC a reason to stutter.
 *
 * @param geometry - Arc from {@link buildArc}.
 * @param t - Progress, `0`–`1`. Values outside are clamped.
 * @param out - Two-element target; `out[0]` receives x, `out[1]` receives y.
 */
export function pointAt(geometry: ArcGeometry, t: number, out: Float32Array | number[]): void {
  const { points, distances, length } = geometry;
  const count = distances.length;

  const clamped = Math.max(0, Math.min(1, t));
  const target = clamped * length;

  // The arc is degenerate (both endpoints projected to the same pixel).
  if (length === 0) {
    out[0] = points[0] as number;
    out[1] = points[1] as number;
    return;
  }

  const i = upperBound(distances, target);
  if (i <= 0) {
    out[0] = points[0] as number;
    out[1] = points[1] as number;
    return;
  }
  if (i >= count) {
    out[0] = points[(count - 1) * 2] as number;
    out[1] = points[(count - 1) * 2 + 1] as number;
    return;
  }

  const d0 = distances[i - 1] as number;
  const d1 = distances[i] as number;
  const span = d1 - d0;
  // A zero-length span is the antimeridian seam; snap rather than dividing by 0.
  const f = span > 0 ? (target - d0) / span : 0;

  const x0 = points[(i - 1) * 2] as number;
  const y0 = points[(i - 1) * 2 + 1] as number;
  const x1 = points[i * 2] as number;
  const y1 = points[i * 2 + 1] as number;

  out[0] = x0 + (x1 - x0) * f;
  out[1] = y0 + (y1 - y0) * f;
}

/** First index whose cumulative distance exceeds `target`. Binary search. */
function upperBound(distances: Float32Array, target: number): number {
  let low = 0;
  let high = distances.length - 1;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((distances[mid] as number) < target) low = mid + 1;
    else high = mid;
  }
  return low;
}
