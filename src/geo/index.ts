/**
 * Boundary geometry loading — the `react-threat-map/geo` entry point.
 *
 * This module is deliberately separate from the component entry. `<ThreatMap>`
 * reaches it through a dynamic `import()`, so bundlers emit it as its own chunk
 * and the ~220 kB of TopoJSON never lands in a consumer's main bundle. A
 * consumer who imports only `aggregateAttacks` never downloads it at all.
 *
 * You normally do not import this yourself — the component handles it. Reach for
 * it when you want to preload during app boot, or to feed the `geo` prop.
 *
 * @example Preload during boot so the map paints instantly on mount
 * ```ts
 * import { loadGeoData } from 'react-threat-map/geo';
 *
 * void loadGeoData({ states: true }); // result is cached
 * ```
 *
 * @packageDocumentation
 */

import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';

import type { GeoData, GeoFeature, GeoFeatureCollection } from '../types.js';

export { RegionIndex } from './lookup.js';
export { getRegionById, lookupRegionCode, listRegions, UNKNOWN_REGION } from './regions.js';
export type { RegionEntry } from './regions.js';

/** Options for {@link loadGeoData}. */
export interface LoadGeoOptions {
  /**
   * Also load US state boundaries. Default `false`.
   *
   * Costs a second ~110 kB chunk, so it is opt-in. Note that state-level
   * *aggregation* does not need this — region codes like `"US-CA"` resolve from
   * the inline table. You need it to **draw** state borders, or to reverse-resolve
   * bare coordinates to a state.
   */
  readonly states?: boolean;
}

/**
 * Caches by option set. Loading is idempotent: concurrent callers share one
 * in-flight promise rather than racing two fetches of the same chunk.
 */
const cache = new Map<string, Promise<GeoData>>();

/**
 * Load bundled Natural Earth boundary geometry.
 *
 * Results are cached, so calling this repeatedly is free and safe. Concurrent
 * calls share a single in-flight request.
 *
 * @param options - See {@link LoadGeoOptions}.
 * @returns Country boundaries, plus US states when requested.
 * @throws If the underlying chunk fails to load (offline, CSP, bad deploy). The
 *   component catches this and reports it through `onError` rather than crashing.
 *
 * @example
 * ```ts
 * const geo = await loadGeoData({ states: true });
 * console.log(geo.countries.features.length); // 177
 * ```
 */
export function loadGeoData(options: LoadGeoOptions = {}): Promise<GeoData> {
  const wantStates = options.states === true;
  const key = wantStates ? 'countries+states' : 'countries';

  const existing = cache.get(key);
  if (existing) return existing;

  const promise = loadUncached(wantStates).catch((error: unknown) => {
    // Do not cache failures — a transient network error should not permanently
    // poison the map for the rest of the session.
    cache.delete(key);
    throw error;
  });

  cache.set(key, promise);
  return promise;
}

async function loadUncached(wantStates: boolean): Promise<GeoData> {
  const [countries, states] = await Promise.all([
    loadCountries(),
    wantStates ? loadStates() : Promise.resolve(undefined),
  ]);

  return states ? { countries, states } : { countries };
}

async function loadCountries(): Promise<GeoFeatureCollection> {
  const [topoModule, smallModule] = await Promise.all([
    import('./data/countries.json'),
    import('./data/small-countries.json'),
  ]);

  const main = decode(topoModule.default as unknown as Topology, 'countries');
  const small = (smallModule.default as unknown as GeoFeatureCollection).features;

  // Small countries go FIRST, and the order is load-bearing. Reverse lookup
  // returns the first feature whose polygon contains the point, and at 1:110m
  // the Johor Strait is not resolved — Singapore's island is drawn *inside*
  // Malaysia's polygon. Testing Singapore first is what makes a Singapore
  // coordinate resolve to `SG` rather than `MY`. Same for Hong Kong inside China.
  //
  // Draw order is unaffected in practice: these countries are sub-pixel at world
  // scale, so being painted under their neighbours changes nothing visible.
  return { type: 'FeatureCollection', features: [...small, ...main.features] };
}

async function loadStates(): Promise<GeoFeatureCollection> {
  const topo = (await import('./data/states.json')).default as unknown as Topology;
  return decode(topo, 'states');
}

/**
 * Decode one TopoJSON object into GeoJSON features.
 *
 * The generated files already carry canonical ids and `{name, kind, countryCode}`
 * properties — see `scripts/build-geo.mjs` — so this is a straight decode with
 * no remapping.
 */
function decode(topo: Topology, objectName: string): GeoFeatureCollection {
  const object = topo.objects[objectName];
  if (!object) {
    throw new Error(`[react-threat-map] TopoJSON is missing object "${objectName}". Geo data is corrupt.`);
  }

  const collection = feature(topo, object as GeometryCollection) as unknown as {
    features: GeoFeature[];
  };

  return { type: 'FeatureCollection', features: collection.features };
}
