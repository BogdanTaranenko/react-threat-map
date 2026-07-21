import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThreatMap } from '../../src/components/ThreatMap.js';
import type { Attack, GeoData } from '../../src/types.js';

/**
 * jsdom implements neither Canvas 2D nor Path2D nor rAF timing. We stub the
 * minimum surface so the component's React behaviour — mounting, sizing, prop
 * plumbing, error paths — is testable. Pixel output is verified by the demo app,
 * not here; asserting on rasterized pixels would test jsdom's canvas polyfill
 * more than it tests this library.
 */
const contexts: Array<Record<string, unknown>> = [];

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
    const ctx = {
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
    };
    contexts.push(ctx);
    return ctx as unknown as CanvasRenderingContext2D;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

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
}

/** Minimal stand-in geo, so tests never touch the real 40 kB chunk. */
const FAKE_GEO: GeoData = {
  countries: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'FR',
        properties: { name: 'France', kind: 'country', countryCode: 'FR' },
        geometry: { type: 'Polygon', coordinates: [[[0, 40], [10, 40], [10, 50], [0, 50], [0, 40]]] },
      },
    ],
  },
};

const ATTACKS: Attack[] = [
  { id: 'a', from: 'CN', to: 'US-CA', severity: 'high' },
  { id: 'b', from: 'RU', to: 'FR', severity: 'critical' },
];

beforeEach(() => {
  contexts.length = 0;
  installCanvasStubs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<ThreatMap>', () => {
  describe('the simplest possible usage', () => {
    it('renders with only an attacks prop', () => {
      // This is the headline API claim from the README; it must not need
      // width, height, geo, or any config.
      expect(() => render(<ThreatMap attacks={ATTACKS} />)).not.toThrow();
    });

    it('renders with an empty attack list', () => {
      expect(() => render(<ThreatMap attacks={[]} />)).not.toThrow();
    });

    it('exposes an accessible image role and a default label', () => {
      render(<ThreatMap attacks={ATTACKS} width={800} height={400} />);
      expect(screen.getByRole('img')).toHaveAccessibleName('Cyberattack threat map');
    });

    it('accepts a custom aria-label', () => {
      render(<ThreatMap attacks={ATTACKS} width={800} height={400} ariaLabel="Live intrusion feed" />);
      expect(screen.getByRole('img')).toHaveAccessibleName('Live intrusion feed');
    });
  });

  describe('sizing', () => {
    it('mounts two stacked canvases when given explicit dimensions', () => {
      const { container } = render(<ThreatMap attacks={ATTACKS} width={800} height={400} />);
      // One for the static base map, one for the animated threats.
      expect(container.querySelectorAll('canvas')).toHaveLength(2);
    });

    it('sizes canvases in device pixels while laying them out in CSS pixels', () => {
      const { container } = render(<ThreatMap attacks={ATTACKS} width={800} height={400} />);
      const canvas = container.querySelector('canvas')!;

      // devicePixelRatio is 1 in jsdom.
      expect(canvas.getAttribute('width')).toBe('800');
      expect(canvas.style.width).toBe('100%');
    });

    it('derives a height from the projection aspect ratio when only width is given', () => {
      const { container } = render(<ThreatMap attacks={ATTACKS} width={800} />);
      // naturalEarth1 is 2:1, so 800 -> 400.
      expect(container.querySelector('canvas')?.getAttribute('height')).toBe('400');
    });

    it('renders no canvases until a size is known', () => {
      // No width/height and no ResizeObserver measurement yet.
      const { container } = render(<ThreatMap attacks={ATTACKS} />);
      expect(container.querySelectorAll('canvas')).toHaveLength(0);
    });

    it('falls back to an aspect-ratio box when no height is given', () => {
      const { container } = render(<ThreatMap attacks={ATTACKS} />);
      const wrapper = container.firstElementChild as HTMLElement;

      // naturalEarth1 is 2:1, so the box is twice as wide as it is tall.
      expect(wrapper.style.aspectRatio).toBe('2');
      expect(wrapper.style.height).toBe('');
    });

    it('applies consumer className and style to the wrapper', () => {
      const { container } = render(
        <ThreatMap attacks={ATTACKS} width={800} height={400} className="my-map" style={{ borderRadius: 8 }} />,
      );
      const wrapper = container.firstElementChild as HTMLElement;

      expect(wrapper).toHaveClass('my-map');
      expect(wrapper.style.borderRadius).toBe('8px');
      // The wrapper must stay a positioning context for the absolute canvases.
      expect(wrapper.style.position).toBe('relative');
    });
  });

  describe('geo loading', () => {
    it('accepts geo data directly, skipping the lazy chunk', async () => {
      render(<ThreatMap attacks={ATTACKS} width={800} height={400} geo={FAKE_GEO} />);
      await waitFor(() => expect(contexts.length).toBeGreaterThan(0));
    });

    it('accepts an async geo loader', async () => {
      const loader = vi.fn(async () => FAKE_GEO);
      render(<ThreatMap attacks={ATTACKS} width={800} height={400} geo={loader} />);
      await waitFor(() => expect(loader).toHaveBeenCalled());
    });

    it('reports a geo load failure through onError instead of crashing', async () => {
      const onError = vi.fn();
      const failing = vi.fn(async () => {
        throw new Error('network down');
      });

      render(<ThreatMap attacks={ATTACKS} width={800} height={400} geo={failing} onError={onError} />);

      await waitFor(() => expect(onError).toHaveBeenCalled());
      expect(onError.mock.calls[0]?.[0]).toMatchObject({ kind: 'geo-load' });
      // The map itself survives.
      expect(screen.getByRole('img')).toBeInTheDocument();
    });

    it('still renders threats while geometry is loading', () => {
      // A pending loader: the threat layer must not wait for boundaries.
      const pending = () => new Promise<GeoData>(() => {});
      const { container } = render(<ThreatMap attacks={ATTACKS} width={800} height={400} geo={pending} />);
      expect(container.querySelectorAll('canvas')).toHaveLength(2);
    });
  });

  describe('error reporting', () => {
    it('reports an unresolvable attack through onError', async () => {
      const onError = vi.fn();
      render(
        <ThreatMap attacks={[{ id: 'x', from: 'ATLANTIS', to: 'FR' }]} width={800} height={400} geo={FAKE_GEO} onError={onError} />,
      );

      await waitFor(() => expect(onError).toHaveBeenCalled());
      expect(onError.mock.calls[0]?.[0]).toMatchObject({ kind: 'resolve' });
    });

    it('warns in development when no onError handler is supplied', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(<ThreatMap attacks={[{ from: 'NOPE', to: 'FR' }]} width={800} height={400} geo={FAKE_GEO} />);

      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls[0]?.[0]).toMatch(/react-threat-map/);
    });

    it('does not crash when a renderRegion hook throws', async () => {
      const onError = vi.fn();
      render(
        <ThreatMap
          attacks={ATTACKS}
          width={800}
          height={400}
          geo={FAKE_GEO}
          onError={onError}
          renderRegion={() => {
            throw new Error('boom');
          }}
        />,
      );

      await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'render' })));
      expect(screen.getByRole('img')).toBeInTheDocument();
    });
  });

  describe('interactivity', () => {
    it('leaves the threat canvas click-through when no handlers are given', () => {
      const { container } = render(<ThreatMap attacks={ATTACKS} width={800} height={400} />);
      const [, threatCanvas] = Array.from(container.querySelectorAll('canvas'));
      // Otherwise the canvas would swallow clicks meant for the consumer's own UI.
      expect(threatCanvas?.style.pointerEvents).toBe('none');
    });

    it('enables pointer events once a handler is given', () => {
      const { container } = render(
        <ThreatMap attacks={ATTACKS} width={800} height={400} onThreatClick={() => {}} />,
      );
      const [, threatCanvas] = Array.from(container.querySelectorAll('canvas'));
      expect(threatCanvas?.style.pointerEvents).toBe('auto');
    });
  });

  describe('lifecycle', () => {
    it('unmounts without throwing', () => {
      const { unmount } = render(<ThreatMap attacks={ATTACKS} width={800} height={400} geo={FAKE_GEO} />);
      expect(() => unmount()).not.toThrow();
    });

    it('survives rapid attack list churn', () => {
      const { rerender } = render(<ThreatMap attacks={ATTACKS} width={800} height={400} geo={FAKE_GEO} />);

      expect(() => {
        for (let i = 0; i < 25; i++) {
          rerender(
            <ThreatMap
              attacks={Array.from({ length: i }, (_, j) => ({ id: `t${j}`, from: 'FR', to: 'JP' }))}
              width={800}
              height={400}
              geo={FAKE_GEO}
            />,
          );
        }
      }).not.toThrow();
    });

    it('handles a projection swap', () => {
      const { rerender, container } = render(
        <ThreatMap attacks={ATTACKS} width={800} height={400} projection="naturalEarth1" geo={FAKE_GEO} />,
      );
      rerender(<ThreatMap attacks={ATTACKS} width={800} height={400} projection="orthographic" geo={FAKE_GEO} />);

      expect(container.querySelectorAll('canvas')).toHaveLength(2);
    });

    it('accepts inline config object literals without stalling', () => {
      // Consumers write these inline constantly; a new identity each render must
      // not break anything.
      const { rerender } = render(
        <ThreatMap attacks={ATTACKS} width={800} height={400} theme={{ ocean: '#000' }} line={{ curvature: 0.4 }} geo={FAKE_GEO} />,
      );
      expect(() =>
        rerender(
          <ThreatMap attacks={ATTACKS} width={800} height={400} theme={{ ocean: '#000' }} line={{ curvature: 0.4 }} geo={FAKE_GEO} />,
        ),
      ).not.toThrow();
    });
  });

  describe('reduced motion', () => {
    it('disables animation when the user prefers reduced motion', () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      // Arcs still render; they simply hold still.
      const { container } = render(<ThreatMap attacks={ATTACKS} width={800} height={400} geo={FAKE_GEO} />);
      expect(container.querySelectorAll('canvas')).toHaveLength(2);
    });
  });
});
