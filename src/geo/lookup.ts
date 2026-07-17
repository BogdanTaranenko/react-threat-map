/**
 * Reverse geo lookup: a raw `{lat, lng}` → the region that contains it.
 *
 * Only needed when a consumer supplies bare coordinates and wants aggregation.
 * Attacks carrying an explicit region code skip this entirely — which is why
 * `{ lat, lng, region }` is the recommended shape for high-volume feeds.
 *
 * @packageDocumentation
 */

import type { GeoFeature, GeoData, LatLng, ResolvedRegion } from '../types.js';
import { UNKNOWN_REGION } from './regions.js';

/** Axis-aligned bounds in degrees: `[minLng, minLat, maxLng, maxLat]`. */
type BBox = [number, number, number, number];

interface IndexedFeature {
  readonly bbox: BBox;
  readonly feature: GeoFeature;
  readonly region: ResolvedRegion;
}

/**
 * Point-in-region index over a {@link GeoData} set.
 *
 * Naive point-in-polygon against ~230 features costs ~230 polygon walks per
 * query, and a 500-attack feed re-resolving on every update makes that the
 * dominant cost in the whole pipeline. Three things fix it:
 *
 * 1. **Bounding-box rejection.** Four float compares eliminate ~99% of
 *    candidates before any polygon walk. Boxes are computed once at construction.
 * 2. **States before countries.** A point inside California is also inside the
 *    US; testing states first means `'auto'` granularity gets the specific answer
 *    without testing twice.
 * 3. **Memoization on a rounded key.** Attack feeds repeat origins heavily
 *    (the same datacenter, over and over), so a cache keyed on coordinates
 *    rounded to ~1 km turns the common case into a Map hit.
 */
export class RegionIndex {
  readonly #countries: IndexedFeature[] = [];
  readonly #states: IndexedFeature[] = [];
  readonly #cache = new Map<string, ResolvedRegion>();

  /** Cache entries beyond this are dropped, bounding memory on unbounded feeds. */
  static readonly #MAX_CACHE = 20_000;

  constructor(geo: GeoData) {
    for (const f of geo.countries.features) {
      this.#countries.push(indexFeature(f));
    }
    for (const f of geo.states?.features ?? []) {
      this.#states.push(indexFeature(f));
    }
  }

  /** Whether US state geometry is present, and so whether state resolution can succeed. */
  get hasStates(): boolean {
    return this.#states.length > 0;
  }

  /**
   * Find the region containing a point.
   *
   * @param point - Coordinates in degrees.
   * @param preferStates - When `true`, return the US state if the point is in one.
   *   When `false`, always return the country. Maps to aggregation granularity.
   * @returns The containing region, or {@link UNKNOWN_REGION} for points in the
   *   ocean or outside all known boundaries.
   */
  resolve(point: LatLng, preferStates: boolean): ResolvedRegion {
    const key = cacheKey(point, preferStates);
    const cached = this.#cache.get(key);
    if (cached) return cached;

    const result = this.#resolveUncached(point, preferStates);

    if (this.#cache.size >= RegionIndex.#MAX_CACHE) this.#cache.clear();
    this.#cache.set(key, result);
    return result;
  }

  #resolveUncached(point: LatLng, preferStates: boolean): ResolvedRegion {
    if (preferStates) {
      const state = search(this.#states, point);
      if (state) return state;
    }
    return search(this.#countries, point) ?? UNKNOWN_REGION;
  }
}

function search(features: readonly IndexedFeature[], point: LatLng): ResolvedRegion | null {
  for (const entry of features) {
    if (!inBBox(entry.bbox, point)) continue;
    if (featureContains(entry.feature, point)) return entry.region;
  }
  return null;
}

function cacheKey(point: LatLng, preferStates: boolean): string {
  // ~1 km at the equator. Coarse enough to get real hit rates on repeated
  // origins, fine enough that it never crosses a border that matters at world
  // -map scale.
  const lat = Math.round(point.lat * 100);
  const lng = Math.round(point.lng * 100);
  return `${lat},${lng},${preferStates ? 1 : 0}`;
}

function indexFeature(feature: GeoFeature): IndexedFeature {
  return {
    bbox: computeBBox(feature),
    feature,
    region: {
      id: feature.id,
      name: feature.properties.name,
      kind: feature.properties.kind,
      countryCode: feature.properties.countryCode,
    },
  };
}

/** Visits every linear ring of a feature, flattening Polygon/MultiPolygon. */
function forEachRing(feature: GeoFeature, visit: (ring: readonly number[][]) => void): void {
  const { geometry } = feature;
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) visit(ring);
    return;
  }
  for (const polygon of geometry.coordinates) {
    for (const ring of polygon) visit(ring);
  }
}

function computeBBox(feature: GeoFeature): BBox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  forEachRing(feature, (ring) => {
    for (const position of ring) {
      const lng = position[0] as number;
      const lat = position[1] as number;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  });

  return [minLng, minLat, maxLng, maxLat];
}

function inBBox(bbox: BBox, point: LatLng): boolean {
  return point.lng >= bbox[0] && point.lng <= bbox[2] && point.lat >= bbox[1] && point.lat <= bbox[3];
}

/**
 * Point-in-polygon across every ring of a feature, honoring holes.
 *
 * Uses an even-odd crossing count in planar lng/lat space. That is an
 * approximation — it ignores great-circle edges and does not handle polygons
 * crossing the antimeridian — but Natural Earth splits antimeridian-crossing
 * countries into separate polygons, so the approximation is exact for the data
 * we ship, and far cheaper than spherical containment.
 *
 * Ring winding order is not assumed. GeoJSON says exterior rings wind
 * counter-clockwise and holes clockwise, but real-world data violates this
 * constantly. Instead we count crossings across all rings of a polygon: a point
 * inside a hole crosses that hole's ring an odd number of extra times and so
 * lands outside. This is correct regardless of winding.
 */
function featureContains(feature: GeoFeature, point: LatLng): boolean {
  const { geometry } = feature;
  if (geometry.type === 'Polygon') {
    return polygonContains(geometry.coordinates, point);
  }
  for (const polygon of geometry.coordinates) {
    if (polygonContains(polygon, point)) return true;
  }
  return false;
}

function polygonContains(rings: readonly number[][][], point: LatLng): boolean {
  let inside = false;
  for (const ring of rings) {
    if (ringCrossings(ring, point)) inside = !inside;
  }
  return inside;
}

/** @returns `true` if a ray cast from the point crosses this ring an odd number of times. */
function ringCrossings(ring: readonly number[][], point: LatLng): boolean {
  const { lat, lng } = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as number[];
    const b = ring[j] as number[];
    const aLng = a[0] as number;
    const aLat = a[1] as number;
    const bLng = b[0] as number;
    const bLat = b[1] as number;

    // Does the edge straddle the horizontal ray at `lat`?
    if (aLat > lat !== bLat > lat) {
      // x-coordinate where the edge crosses that ray.
      const t = (lat - aLat) / (bLat - aLat);
      if (lng < aLng + t * (bLng - aLng)) inside = !inside;
    }
  }
  return inside;
}
