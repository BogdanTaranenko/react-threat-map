import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThreatMap } from '../../src/components/ThreatMap.js';
import type { Attack, GeoData } from '../../src/types.js';

/**
 * Counts base-map rasterizations.
 *
 * The base map is the expensive half of the component — ~230 country and state
 * outlines — and the entire reason it lives on its own canvas is that it should
 * be drawn once per *layout*, never per render. This spy is what proves that
 * claim holds, so it is worth the mock.
 */
let baseMapDraws = 0;

vi.mock('../../src/render/drawBaseMap.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/drawBaseMap.js')>();
  return {
    ...actual,
    drawBaseMap: (options: Parameters<typeof actual.drawBaseMap>[0]) => {
      baseMapDraws++;
      return actual.drawBaseMap(options);
    },
  };
});

const FAKE_GEO: GeoData = { countries: { type: 'FeatureCollection', features: [] } };
const ATTACKS: Attack[] = [{ id: 'a', from: 'CN', to: 'US-CA' }];

beforeEach(() => {
  baseMapDraws = 0;

  vi.stubGlobal(
    'Path2D',
    class {
      moveTo(): void {}
      lineTo(): void {}
      arc(): void {}
      rect(): void {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

  HTMLCanvasElement.prototype.getContext = vi.fn(function getContext(this: HTMLCanvasElement) {
    return {
      canvas: this,
      setTransform() {},
      clearRect() {},
      fillRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      closePath() {},
      stroke() {},
      fill() {},
      save() {},
      restore() {},
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Re-render `count` times and report how many base-map redraws that caused. */
function redrawsAcrossRerenders(element: (key: number) => JSX.Element, count = 5): number {
  const { rerender } = render(element(0));
  const afterMount = baseMapDraws;
  for (let i = 1; i <= count; i++) rerender(element(i));
  return baseMapDraws - afterMount;
}

describe('config stability', () => {
  describe('inline config objects', () => {
    // Regression. Configs were memoized with `useMemo(..., [props.theme])`, which
    // keys on the caller's *object identity* — worthless for the way these props
    // are almost always written, since an inline literal is a new object every
    // render. The memo recomputed every render and re-triggered the base map's
    // effect, re-rasterizing ~230 outlines. A streaming feed re-renders
    // constantly, so this hit the library's headline use case on every update.

    it('does not re-rasterize the base map when regions is written inline', () => {
      const redraws = redrawsAcrossRerenders((key) => (
        <ThreatMap attacks={ATTACKS} width={800} height={400} geo={FAKE_GEO} regions={{ showStates: true }} key={undefined} data-k={key} />
      ));
      expect(redraws).toBe(0);
    });

    it('does not re-rasterize when theme is written inline', () => {
      const redraws = redrawsAcrossRerenders((key) => (
        <ThreatMap attacks={ATTACKS} width={800} height={400} geo={FAKE_GEO} theme={{ ocean: '#000' }} data-k={key} />
      ));
      expect(redraws).toBe(0);
    });

    it('does not re-rasterize when a nested severityColors override is written inline', () => {
      const redraws = redrawsAcrossRerenders((key) => (
        <ThreatMap
          attacks={ATTACKS}
          width={800}
          height={400}
          geo={FAKE_GEO}
          theme={{ ocean: '#000', severityColors: { critical: '#f0f' } }}
          data-k={key}
        />
      ));
      expect(redraws).toBe(0);
    });

    it('does not re-rasterize when every config is written inline at once', () => {
      const redraws = redrawsAcrossRerenders((key) => (
        <ThreatMap
          attacks={ATTACKS}
          width={800}
          height={400}
          geo={FAKE_GEO}
          theme={{ ocean: '#000' }}
          line={{ curvature: 0.3 }}
          animation={{ speed: 1 }}
          regions={{ showStates: true }}
          data-k={key}
        />
      ));
      expect(redraws).toBe(0);
    });

    it('still does not re-rasterize when the config object is hoisted', () => {
      const REGIONS = { showStates: true };
      const redraws = redrawsAcrossRerenders((key) => (
        <ThreatMap attacks={ATTACKS} width={800} height={400} geo={FAKE_GEO} regions={REGIONS} data-k={key} />
      ));
      expect(redraws).toBe(0);
    });
  });

  describe('real config changes still take effect', () => {
    // The other half of the contract: value-stability must not mean values are ignored.

    it('re-rasterizes when a theme value actually changes', () => {
      const { rerender } = render(<ThreatMap attacks={ATTACKS} width={800} height={400} geo={FAKE_GEO} theme={{ ocean: '#000' }} />);
      const before = baseMapDraws;

      rerender(<ThreatMap attacks={ATTACKS} width={800} height={400} geo={FAKE_GEO} theme={{ ocean: '#fff' }} />);

      expect(baseMapDraws).toBeGreaterThan(before);
    });

    it('re-rasterizes when a nested severityColors value changes', () => {
      const view = (color: string) => (
        <ThreatMap attacks={ATTACKS} width={800} height={400} geo={FAKE_GEO} theme={{ severityColors: { critical: color } }} />
      );
      const { rerender } = render(view('#f00'));
      const before = baseMapDraws;

      rerender(view('#0f0'));

      expect(baseMapDraws).toBeGreaterThan(before);
    });

    it('re-rasterizes when regions toggles', () => {
      const view = (showStates: boolean) => (
        <ThreatMap attacks={ATTACKS} width={800} height={400} geo={FAKE_GEO} regions={{ showStates }} />
      );
      const { rerender } = render(view(false));
      const before = baseMapDraws;

      rerender(view(true));

      expect(baseMapDraws).toBeGreaterThan(before);
    });
  });
});
