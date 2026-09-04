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

    let unlisten: (() => void) | undefined;

    const update = () => {
      unlisten?.();
      setRatio(currentRatio());
      listen();
    };

    // The query matches one exact ratio, so it must be rebuilt after each
    // change to watch for the next one.
    const listen = () => {
      // Safari did not support the `resolution` media feature until 16, so this
      // query never matches there and the ratio simply stays at its mount value
      // — correct until the window is dragged to a display with a different
      // one, which is a sharpness nit rather than a break.
      const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);

      // Safari and iOS only made MediaQueryList an EventTarget in 14; see
      // useReducedMotion. Both branches unsubscribe explicitly in `update`
      // rather than relying on the `once` option, so they behave identically.
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', update);
        unlisten = () => query.removeEventListener('change', update);
        return;
      }

      query.addListener(update);
      unlisten = () => query.removeListener(update);
    };

    listen();
    return () => unlisten?.();
  }, []);

  return ratio;
}
