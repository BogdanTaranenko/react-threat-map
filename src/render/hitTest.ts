/**
 * Pointer hit testing against threat arcs.
 *
 * @packageDocumentation
 */

import type { ArcGeometry } from './path.js';

/** How close (in CSS pixels) the pointer must be to an arc to hit it. */
export const HIT_TOLERANCE = 5;

/**
 * Squared distance from a point to a line segment.
 *
 * Squared, because we only ever compare it against a squared tolerance — and
 * this runs for every segment of every threat on every mousemove, where ~25k
 * `Math.hypot` calls per pointer pixel would be felt.
 */
function distanceSquaredToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    const cx = px - ax;
    const cy = py - ay;
    return cx * cx + cy * cy;
  }

  // Project the point onto the segment, clamped to the segment's extent.
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  const cx = px - (ax + t * dx);
  const cy = py - (ay + t * dy);
  return cx * cx + cy * cy;
}

/**
 * Nearest-point distance from a pointer to an arc, squared.
 *
 * Rejects on the arc's bounding box first: a pointer is near at most a couple of
 * arcs, so most threats can be dismissed without walking their 48 segments.
 *
 * @param geometry - The arc to test.
 * @param x - Pointer x in CSS pixels.
 * @param y - Pointer y in CSS pixels.
 * @param tolerance - Hit radius, used for the bbox margin.
 * @returns Squared distance, or `Infinity` when the bbox rejects it.
 */
export function distanceToArcSquared(geometry: ArcGeometry, x: number, y: number, tolerance: number): number {
  const { points, breakAt, distances } = geometry;
  const count = distances.length;
  if (count < 2) return Infinity;

  let best = Infinity;
  for (let i = 1; i < count; i++) {
    // The seam is not a real segment; the arc does not pass through it.
    if (i === breakAt) continue;

    const ax = points[(i - 1) * 2] as number;
    const ay = points[(i - 1) * 2 + 1] as number;
    const bx = points[i * 2] as number;
    const by = points[i * 2 + 1] as number;

    // Cheap per-segment bbox reject before the projection math.
    if (
      (ax < x - tolerance && bx < x - tolerance) ||
      (ax > x + tolerance && bx > x + tolerance) ||
      (ay < y - tolerance && by < y - tolerance) ||
      (ay > y + tolerance && by > y + tolerance)
    ) {
      continue;
    }

    const d = distanceSquaredToSegment(x, y, ax, ay, bx, by);
    if (d < best) best = d;
  }

  return best;
}

/** A threat paired with the geometry to test against. */
export interface HitCandidate<T> {
  readonly value: T;
  readonly geometry: ArcGeometry;
  /** Thicker threats deserve a proportionally larger hit radius. */
  readonly intensity: number;
}

/**
 * Find the threat nearest the pointer, within tolerance.
 *
 * Returns the *closest* match rather than the first, so overlapping arcs pick
 * the one the user actually aimed at.
 *
 * @param candidates - Threats with live geometry.
 * @param x - Pointer x in CSS pixels.
 * @param y - Pointer y in CSS pixels.
 * @param baseWidth - The configured line width, which scales the hit radius.
 * @returns The nearest threat within tolerance, or `null`.
 */
export function hitTest<T>(
  candidates: Iterable<HitCandidate<T>>,
  x: number,
  y: number,
  baseWidth: number,
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    // A heavy aggregate is drawn thicker, so its clickable area should match
    // what the user sees rather than a uniform hairline.
    const tolerance = HIT_TOLERANCE + (baseWidth * candidate.intensity) / 2;
    const distance = distanceToArcSquared(candidate.geometry, x, y, tolerance);

    if (distance <= tolerance * tolerance && distance < bestDistance) {
      bestDistance = distance;
      best = candidate.value;
    }
  }

  return best;
}
