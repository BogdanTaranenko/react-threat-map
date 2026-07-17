/**
 * Turning an {@link AttackLocation} into a coordinate plus a region.
 *
 * Pure and synchronous. The one async ingredient — boundary geometry, needed
 * only to reverse-resolve bare coordinates — is passed in as an optional
 * {@link RegionIndex}, so this module and everything downstream of it (all of
 * aggregation) stays testable without loading a single byte of geometry.
 *
 * @packageDocumentation
 */

import type { AttackLocation, LatLng, ResolvedRegion } from '../types.js';
import type { RegionIndex } from './lookup.js';
import { lookupRegionCode, UNKNOWN_REGION } from './regions.js';

/** A location resolved to a drawable point and a groupable region. */
export interface ResolvedLocation {
  /** Where to draw. */
  readonly point: LatLng;
  /** What to group by. `kind: 'unknown'` when the region could not be determined. */
  readonly region: ResolvedRegion;
}

/** Returned instead of throwing when a location cannot be resolved at all. */
export interface ResolveFailure {
  readonly ok: false;
  /** Why it failed, suitable for an `onError` message. */
  readonly reason: string;
}

/** A successful resolution. */
export interface ResolveSuccess {
  readonly ok: true;
  readonly value: ResolvedLocation;
}

/** Result of {@link resolveLocation}. */
export type ResolveResult = ResolveSuccess | ResolveFailure;

/**
 * Narrow an {@link AttackLocation} to its coordinate form.
 *
 * @internal
 */
function isLatLng(location: AttackLocation): location is LatLng & { region?: string } {
  return typeof location === 'object' && location !== null && 'lat' in location && 'lng' in location;
}

function isValidCoordinate(point: LatLng): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

/**
 * Resolve a location to a point and a region.
 *
 * Three input shapes, in increasing cost:
 *
 * - **Region code** (`"US-CA"`) — one Map lookup. The anchor coordinate is used
 *   as the point.
 * - **Coordinates + region** (`{lat, lng, region: 'US-CA'}`) — one Map lookup,
 *   exact point. The cheapest option that also gives pixel-accurate placement.
 * - **Bare coordinates** (`{lat, lng}`) — needs `index` to reverse-resolve via
 *   point-in-polygon. Without an index the point still renders, but its region
 *   is `unknown`, so it will not aggregate with anything.
 *
 * Never throws. Invalid input returns a {@link ResolveFailure} the caller can
 * surface through `onError`, so one malformed row cannot take down the map.
 *
 * @param location - The location to resolve.
 * @param index - Boundary index for reverse lookup. Omit if geometry is not loaded yet.
 * @param preferStates - Resolve bare coordinates to US states where possible.
 *   Ignored for explicit region codes, which are already as specific as they are.
 *
 * @example
 * ```ts
 * resolveLocation('US-CA');                          // ok, point = California anchor
 * resolveLocation({ lat: 34, lng: -118 }, index, true); // ok, region = US-CA
 * resolveLocation('NOPE');                           // { ok: false, reason: ... }
 * ```
 */
export function resolveLocation(
  location: AttackLocation,
  index?: RegionIndex | null,
  preferStates = true,
): ResolveResult {
  if (typeof location === 'string') {
    const entry = lookupRegionCode(location);
    if (!entry) {
      return {
        ok: false,
        reason: `Unknown region code "${location}". Expected an ISO 3166-1 alpha-2/alpha-3 country code (e.g. "FR", "FRA") or an ISO 3166-2 US state code (e.g. "US-CA").`,
      };
    }
    return { ok: true, value: { point: entry.anchor, region: toRegion(entry) } };
  }

  if (!isLatLng(location)) {
    return {
      ok: false,
      reason: `Invalid location ${JSON.stringify(location)}. Expected a region code string or a {lat, lng} object.`,
    };
  }

  const point: LatLng = { lat: location.lat, lng: location.lng };
  if (!isValidCoordinate(point)) {
    return {
      ok: false,
      reason: `Invalid coordinates {lat: ${location.lat}, lng: ${location.lng}}. Latitude must be within [-90, 90] and longitude within [-180, 180].`,
    };
  }

  // An explicit region wins: it is what the consumer asserted, it is cheaper
  // than a polygon walk, and it is what their geo-IP database already decided.
  if (location.region) {
    const entry = lookupRegionCode(location.region);
    if (entry) return { ok: true, value: { point, region: toRegion(entry) } };
    // A bad `region` hint is not fatal — fall through to reverse lookup rather
    // than discarding a perfectly good coordinate.
  }

  const region = index ? index.resolve(point, preferStates) : UNKNOWN_REGION;
  return { ok: true, value: { point, region } };
}

function toRegion(entry: { id: string; name: string; kind: ResolvedRegion['kind']; countryCode: string }): ResolvedRegion {
  return { id: entry.id, name: entry.name, kind: entry.kind, countryCode: entry.countryCode };
}
