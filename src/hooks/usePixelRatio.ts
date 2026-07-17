/**
 * Device pixel ratio tracking.
 *
 * @packageDocumentation
 */

import { useEffect, useState } from 'react';

/** Beyond 2x the extra pixels cost real fill rate and buy almost nothing visually. */
const MAX_PIXEL_RATIO = 2;

function currentRatio(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
}

/**
 * The device pixel ratio, kept current as the window moves between displays.
 *
 * Canvas is a raster surface, so it must be sized in device pixels to stay sharp
 * — otherwise the map looks soft on every laptop made in the last decade. The
 * value is capped at 2 because a 3x display would triple the fill rate of the
 * threat layer for a difference nobody can see on an animated line.
 *
 * Dragging a window from a HiDPI screen to a standard one changes the ratio, and
 * without tracking it the canvas would stay at the wrong resolution until the
 * next resize. `matchMedia` on the resolution is the only event for it.
 *
 * @returns The current ratio, between 1 and 2.
 */
export function usePixelRatio(): number {
  const [ratio, setRatio] = useState(currentRatio);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    let query: MediaQueryList;
    const update = () => {
      setRatio(currentRatio());
      listen();
    };

    // The query matches one exact ratio, so it must be rebuilt after each
    // change to watch for the next one.
    const listen = () => {
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener('change', update, { once: true });
    };

    listen();
    return () => query?.removeEventListener('change', update);
  }, []);

  return ratio;
}
