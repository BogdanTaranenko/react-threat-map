/**
 * `prefers-reduced-motion` tracking.
 *
 * @packageDocumentation
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the user has asked their system for reduced motion.
 *
 * A map of dozens of racing, pulsing lines is close to a worst case for anyone
 * with vestibular sensitivity. When this is set, `<ThreatMap>` stops the
 * animation and renders the arcs statically — the information is all still
 * there, it just holds still. Consumers who need to override this can set
 * `animation={{ respectReducedMotion: false }}`.
 *
 * @returns `true` when reduced motion is preferred. Defaults to `false` during
 *   SSR, where no preference is knowable.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(QUERY);
    setReduced(query.matches);

    const update = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}
