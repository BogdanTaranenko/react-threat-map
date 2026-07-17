/**
 * The inline region table: canonical codes and anchor coordinates for every
 * country and US state.
 *
 * This is the one piece of geo data that is **not** lazy-loaded. It is small
 * (~20 kB raw, ~6 kB gzipped) and it must be synchronous, because resolving
 * `"US-CA"` to a coordinate is what lets aggregation stay a pure function with
 * no async and no fetch. Boundary geometry — 100× larger and only needed to
 * *draw* — is loaded separately. See DECISIONS.md §3.
 *
 * @packageDocumentation
 */

import type { LatLng, RegionKind, ResolvedRegion } from '../types.js';
import rawRegions from './data/regions.json' with { type: 'json' };

/**
 * Shape of a row in the generated `regions.json`. Keys are abbreviated because
 * this table ships in the main bundle and the names repeat 233 times.
 *
 * @internal
 */
interface RawRegion {
  /** Canonical id: ISO alpha-2, or ISO 3166-2 for states. */
  readonly id: string;
  /** Display name. */
  readonly n: string;
  /** Granularity. */
  readonly k: 'country' | 'state';
  /** Containing country's alpha-2. */
  readonly c: string;
  /** ISO alpha-3, for countries only. */
  readonly a3: string | null;
  readonly lat: number;
  readonly lng: number;
}

/** A region entry with its anchor coordinate. */
export interface RegionEntry extends ResolvedRegion {
  /** The region's anchor point — see DECISIONS.md §3 on why this is not a true centroid. */
  readonly anchor: LatLng;
  /** ISO alpha-3 code. `null` for US states. */
  readonly alpha3: string | null;
}

const rows = rawRegions as readonly RawRegion[];

function toEntry(r: RawRegion): RegionEntry {
  return {
    id: r.id,
    name: r.n,
    kind: r.k,
    countryCode: r.c,
    alpha3: r.a3,
    anchor: { lat: r.lat, lng: r.lng },
  };
}

/** Every known region, keyed by canonical id (`"FR"`, `"US-CA"`). */
const byId = new Map<string, RegionEntry>();
/** Countries only, keyed by ISO alpha-2. */
const countriesByAlpha2 = new Map<string, RegionEntry>();
/** Countries only, keyed by ISO alpha-3. */
const countriesByAlpha3 = new Map<string, RegionEntry>();
/** US states only, keyed by bare USPS code (`"CA"`, `"TX"`). */
const statesByUsps = new Map<string, RegionEntry>();

for (const row of rows) {
  const entry = toEntry(row);
  byId.set(entry.id, entry);

  if (entry.kind === 'country') {
    countriesByAlpha2.set(entry.id, entry);
    if (entry.alpha3) countriesByAlpha3.set(entry.alpha3, entry);
  } else {
    // "US-CA" -> "CA"
    const usps = entry.id.slice(3);
    statesByUsps.set(usps, entry);
  }
}

/**
 * The sentinel region used when a location cannot be resolved. Never throws —
 * unresolvable input degrades to this so one bad row cannot blank the map.
 */
export const UNKNOWN_REGION: ResolvedRegion = Object.freeze({
  id: '??',
  name: 'Unknown',
  kind: 'unknown' as RegionKind,
  countryCode: '??',
});

/**
 * Look up a region by its canonical id.
 *
 * @param id - `"FR"` or `"US-CA"`. Case-sensitive; use {@link lookupRegionCode} for user input.
 * @returns The region, or `undefined`.
 */
export function getRegionById(id: string): RegionEntry | undefined {
  return byId.get(id);
}

/**
 * Resolve a user-supplied region code to a region.
 *
 * Matching order — see {@link RegionCode} for the full contract:
 * 1. Hyphenated (`"US-CA"`) → US state, exact.
 * 2. Two letters (`"FR"`) → country first, then falling back to a US state.
 *    This is why `"CA"` is Canada and `"TX"` is Texas: `CA` is a real country
 *    code and `TX` is not.
 * 3. Three letters (`"FRA"`) → country by alpha-3.
 *
 * @param code - The identifier. Leading/trailing space and case are ignored.
 * @returns The matching region, or `undefined` if nothing matched.
 *
 * @example
 * ```ts
 * lookupRegionCode('us-ca')?.name; // 'California'
 * lookupRegionCode('CA')?.name;    // 'Canada'  (country wins)
 * lookupRegionCode('TX')?.name;    // 'Texas'   (no country 'TX')
 * lookupRegionCode('FRA')?.name;   // 'France'
 * ```
 */
export function lookupRegionCode(code: string): RegionEntry | undefined {
  const normalized = code.trim().toUpperCase();
  if (normalized.length === 0) return undefined;

  if (normalized.includes('-')) {
    return byId.get(normalized);
  }
  if (normalized.length === 2) {
    return countriesByAlpha2.get(normalized) ?? statesByUsps.get(normalized);
  }
  if (normalized.length === 3) {
    return countriesByAlpha3.get(normalized);
  }
  return undefined;
}

/**
 * Every region the library knows about, countries and US states.
 *
 * Useful for building region pickers or validating a feed before rendering.
 *
 * @returns A new array; the underlying entries are frozen and shared.
 */
export function listRegions(): RegionEntry[] {
  return [...byId.values()];
}
