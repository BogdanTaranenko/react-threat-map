/**
 * Regression tests for the browsers that do not have the APIs the hooks reach
 * for. Each of these reproduced a real failure before the fix:
 *
 * - Safari/iOS <14 exposes `MediaQueryList` without `addEventListener`, which
 *   threw a TypeError during mount and took the consumer's React tree with it.
 * - Safari/iOS <15, Chrome <88 and Firefox <89 do not implement CSS
 *   `aspect-ratio`, so the wrapper collapsed to zero height and the map
 *   rendered nothing at all.
 */

import { render, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThreatMap } from '../../src/components/ThreatMap.js';
import { usePixelRatio } from '../../src/hooks/usePixelRatio.js';
import { useReducedMotion } from '../../src/hooks/useReducedMotion.js';
import { useSupportsAspectRatio } from '../../src/hooks/useSupportsAspectRatio.js';
import type { Attack } from '../../src/types.js';

const ATTACKS: Attack[] = [{ from: 'US', to: 'DE', severity: 'high' }];

/** Listeners registered through the legacy API, so we can fire them. */
interface LegacyRegistry {
  readonly listeners: Array<() => void>;
}

/**
 * A Safari 13 era `matchMedia`: `MediaQueryList` is not an `EventTarget`, so
 * only the deprecated `addListener`/`removeListener` pair exists.
 */
function installLegacyMatchMedia(matches = false): LegacyRegistry {
  const listeners: Array<() => void> = [];

  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addListener: (fn: () => void) => void listeners.push(fn),
    removeListener: (fn: () => void) => {
      const at = listeners.indexOf(fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    // addEventListener / removeEventListener deliberately absent.
  }));

  return { listeners };
}

function installResizeObserver(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

/**
 * jsdom implements neither Canvas 2D nor Path2D. These tests are about layout
 * and event subscription, not pixels, but without a context the component takes
 * its error path and floods stderr — so stub just enough to keep it quiet.
 */
const originalGetContext = HTMLCanvasElement.prototype.getContext;

function installCanvasStubs(): void {
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo(): void {}
      lineTo(): void {}
      arc(): void {}
      rect(): void {}
    },
  );

  HTMLCanvasElement.prototype.getContext = vi.fn(function getContext(this: HTMLCanvasElement) {
    return {
      canvas: this,
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

afterEach(() => {
  vi.unstubAllGlobals();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe('MediaQueryList without addEventListener (Safari/iOS <14)', () => {
  it('useReducedMotion subscribes instead of throwing', () => {
    const registry = installLegacyMatchMedia();

    function Probe(): null {
      useReducedMotion();
      return null;
    }

    expect(() => render(<Probe />)).not.toThrow();
    expect(registry.listeners).toHaveLength(1);
  });

  it('usePixelRatio subscribes instead of throwing', () => {
    const registry = installLegacyMatchMedia();

    function Probe(): null {
      usePixelRatio();
      return null;
    }

    expect(() => render(<Probe />)).not.toThrow();
    expect(registry.listeners).toHaveLength(1);
  });

  it('usePixelRatio re-arms exactly one listener per change', () => {
    const registry = installLegacyMatchMedia();

    function Probe(): null {
      usePixelRatio();
      return null;
    }

    render(<Probe />);
    // The query matches one exact ratio, so each change rebuilds it. The old
    // listener must come off or they accumulate for the life of the component.
    act(() => registry.listeners[0]?.());
    expect(registry.listeners).toHaveLength(1);
  });

  it('both hooks unsubscribe on unmount', () => {
    const registry = installLegacyMatchMedia();

    function Probe(): null {
      useReducedMotion();
      usePixelRatio();
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(registry.listeners).toHaveLength(2);
    unmount();
    expect(registry.listeners).toHaveLength(0);
  });

  it('ThreatMap mounts', () => {
    installLegacyMatchMedia();
    installResizeObserver();
    installCanvasStubs();

    expect(() => render(<ThreatMap attacks={ATTACKS} width={800} height={400} />)).not.toThrow();
  });
});

describe('CSS aspect-ratio unsupported (Safari/iOS <15, Chrome <88, Firefox <89)', () => {
  /** A browser whose CSS.supports rejects everything, as an old one would. */
  function installLegacyCssSupports(): void {
    vi.stubGlobal('CSS', { supports: () => false });
  }

  it('useSupportsAspectRatio reports the lack of support', () => {
    installLegacyCssSupports();

    let seen: boolean | undefined;
    function Probe(): null {
      seen = useSupportsAspectRatio();
      return null;
    }

    render(<Probe />);
    expect(seen).toBe(false);
  });

  it('assumes support when CSS.supports is unavailable, matching SSR', () => {
    vi.stubGlobal('CSS', undefined);

    let seen: boolean | undefined;
    function Probe(): null {
      seen = useSupportsAspectRatio();
      return null;
    }

    render(<Probe />);
    expect(seen).toBe(true);
  });

  it('falls back to a width-derived min-height instead of collapsing', () => {
    installLegacyCssSupports();
    installResizeObserver();
    installCanvasStubs();

    // Width only: exactly the case where aspect-ratio was the sole source of
    // height, and where the wrapper used to collapse to nothing.
    const { container } = render(<ThreatMap attacks={ATTACKS} width={800} />);
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.style.aspectRatio).toBe('');
    // naturalEarth1 is 2:1, so 800 wide floors the box at 400 tall.
    expect(wrapper.style.minHeight).toBe('400px');
  });

  it('still prefers aspect-ratio where it is supported', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    installResizeObserver();
    installCanvasStubs();

    const { container } = render(<ThreatMap attacks={ATTACKS} width={800} />);
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.style.aspectRatio).toBe('2');
    expect(wrapper.style.minHeight).toBe('');
  });

  it('leaves an explicit height untouched', () => {
    installLegacyCssSupports();
    installResizeObserver();
    installCanvasStubs();

    const { container } = render(<ThreatMap attacks={ATTACKS} width={800} height={300} />);
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.style.height).toBe('300px');
    expect(wrapper.style.minHeight).toBe('');
  });
});
