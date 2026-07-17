/**
 * Geo data loading, as a hook.
 *
 * @packageDocumentation
 */

import { useEffect, useState } from 'react';

import type { GeoData, ThreatMapError } from '../types.js';
import { RegionIndex } from '../geo/lookup.js';

/** Loaded geo data plus its reverse-lookup index. */
export interface GeoState {
  readonly geo: GeoData | null;
  /** Index for reverse-resolving bare coordinates. `null` until geo arrives. */
  readonly index: RegionIndex | null;
  readonly loading: boolean;
}

const EMPTY: GeoState = Object.freeze({ geo: null, index: null, loading: true });

/**
 * Load boundary geometry and build its reverse-lookup index.
 *
 * The default path is a dynamic `import()` of `../geo/index.js`, which is what
 * keeps ~220 kB of TopoJSON out of the consumer's main bundle — see
 * DECISIONS.md §3. A consumer-supplied `source` bypasses the import entirely, so
 * self-hosted or preloaded data costs no extra request.
 *
 * @param source - Data or loader from the `geo` prop. `undefined` uses the bundled data.
 * @param wantStates - Whether US state geometry is needed.
 * @param onError - Reports a load failure. The map degrades to blank rather than crashing.
 * @returns The geo data, its index, and a loading flag.
 */
export function useGeoData(
  source: GeoData | (() => Promise<GeoData>) | undefined,
  wantStates: boolean,
  onError?: (error: ThreatMapError) => void,
): GeoState {
  const [state, setState] = useState<GeoState>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    const apply = (geo: GeoData) => {
      if (cancelled) return;
      setState({ geo, index: new RegionIndex(geo), loading: false });
    };

    const fail = (cause: unknown) => {
      if (cancelled) return;
      setState({ geo: null, index: null, loading: false });
      onError?.({
        kind: 'geo-load',
        message: 'Failed to load map geometry. The map will render without boundaries.',
        cause,
      });
    };

    // Data passed directly: synchronous, no request, no chunk.
    if (source && typeof source !== 'function') {
      apply(source);
      return;
    }

    setState((previous) => (previous.loading ? previous : { ...previous, loading: true }));

    const load = source ?? (() => import('../geo/index.js').then((m) => m.loadGeoData({ states: wantStates })));

    Promise.resolve()
      .then(load)
      .then(apply)
      .catch(fail);

    return () => {
      cancelled = true;
    };
    // `onError` is intentionally not a dependency: consumers routinely pass an
    // inline arrow, and depending on it would re-fetch geometry on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, wantStates]);

  return state;
}
