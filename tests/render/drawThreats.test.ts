import { geoEquirectangular } from 'd3-geo';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { drawThreats, __bucketCountForTest } from '../../src/render/drawThreats.js';
import type { RenderableThreat } from '../../src/render/drawThreats.js';
import { buildArc } from '../../src/render/path.js';
import { defaultLineStyle, defaultTheme } from '../../src/config.js';
import type { GeoProjectionLike, Severity, Threat } from '../../src/types.js';

const projection = geoEquirectangular()
  .translate([480, 240])
  .scale(960 / (2 * Math.PI)) as unknown as GeoProjectionLike;

/**
 * jsdom has no Canvas 2D implementation, and node-canvas is a heavy native
 * dependency to add for this. A counting stub is actually the better tool here:
 * the property under test *is* the number of draw calls, so measuring it
 * directly beats rasterizing pixels we would then have to interpret.
 */
function stubContext() {
  const calls = { stroke: 0, fill: 0, clearRect: 0 };
  const ctx = {
    clearRect: () => calls.clearRect++,
    stroke: () => calls.stroke++,
    fill: () => calls.fill++,
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
  return { ctx, calls };
}

/** Path2D is likewise absent in jsdom; the renderer only accumulates into it. */
class FakePath2D {
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
}
vi.stubGlobal('Path2D', FakePath2D);

function makeThreat(id: string, severity: Severity = 'medium', intensity = 1): Threat {
  const region = { id: 'FR', name: 'France', kind: 'country' as const, countryCode: 'FR' };
  return {
    id,
    from: { lat: 48.86, lng: 2.35 },
    to: { lat: 40.71, lng: -74.01 },
    fromRegion: region,
    toRegion: { ...region, id: 'US', name: 'United States', countryCode: 'US' },
    count: 1,
    totalWeight: 1,
    severity,
    intensity,
    attacks: [{ from: 'FR', to: 'US' }],
  };
}

function makeRenderable(threat: Threat, progress = 0.5, alpha = 1): RenderableThreat {
  const geometry = buildArc(threat.from, threat.to, projection, 0.22, 48)!;
  return { threat, geometry, progress, alpha };
}

const baseOptions = (ctx: CanvasRenderingContext2D, threats: readonly RenderableThreat[]) => ({
  ctx,
  width: 960,
  height: 480,
  threats,
  theme: defaultTheme,
  line: defaultLineStyle,
  pixelRatio: 1,
  elapsed: 0,
});

describe('drawThreats', () => {
  beforeEach(() => {
    const { ctx } = stubContext();
    drawThreats(baseOptions(ctx, [])); // reset module-level bucket state
  });

  describe('style batching — the core performance claim', () => {
    it('collapses many same-styled threats into a single bucket', () => {
      const { ctx } = stubContext();
      const threats = Array.from({ length: 500 }, (_, i) => makeRenderable(makeThreat(`t${i}`)));

      drawThreats(baseOptions(ctx, threats));

      expect(__bucketCountForTest()).toBe(1);
    });

    it('keeps draw calls flat as threat count grows 10x', () => {
      const measure = (count: number) => {
        const { ctx, calls } = stubContext();
        const threats = Array.from({ length: count }, (_, i) => makeRenderable(makeThreat(`t${i}`)));
        drawThreats(baseOptions(ctx, threats));
        return calls.stroke + calls.fill;
      };

      // This is the whole argument for Canvas 2D over WebGL at this scale: cost
      // tracks distinct styles, not threat count.
      expect(measure(500)).toBe(measure(50));
    });

    it('plateaus even when every threat is styled differently', () => {
      // The load-bearing version of the claim above. The previous test uses
      // identical threats, where batching is trivially easy. Here each threat has
      // a different severity, intensity, and progress — the worst realistic case
      // — and the draw-call count must *still* stop growing with threat count.
      const severities: Severity[] = ['low', 'medium', 'high', 'critical'];
      const measure = (count: number) => {
        const { ctx, calls } = stubContext();
        const threats = Array.from({ length: count }, (_, i) =>
          makeRenderable(
            makeThreat(`t${i}`, severities[i % 4] as Severity, 1 + (i % 50) / 12),
            (i % 100) / 100,
          ),
        );
        drawThreats(baseOptions(ctx, threats));
        return calls.stroke + calls.fill;
      };

      const at500 = measure(500);
      // Quadrupling the threats must not add a single draw call: every style
      // bucket is already occupied at 500.
      expect(measure(2000)).toBe(at500);
      expect(measure(1000)).toBe(at500);
      // And the ceiling stays bounded rather than drifting toward one call per threat.
      expect(at500).toBeLessThan(250);
    });

    it('buckets by severity colour', () => {
      const { ctx } = stubContext();
      const severities: Severity[] = ['low', 'medium', 'high', 'critical'];
      const threats = severities.flatMap((severity) =>
        Array.from({ length: 50 }, (_, i) => makeRenderable(makeThreat(`${severity}${i}`, severity))),
      );

      drawThreats(baseOptions(ctx, threats));

      // 200 threats, 4 colours -> 4 buckets.
      expect(__bucketCountForTest()).toBe(4);
    });

    it('quantizes width so a continuous intensity scale cannot explode the bucket count', () => {
      const { ctx } = stubContext();
      // 200 threats with 200 distinct intensities. Without quantization this is
      // 200 buckets, i.e. one draw call each, i.e. no batching at all.
      const threats = Array.from({ length: 200 }, (_, i) =>
        makeRenderable(makeThreat(`t${i}`, 'medium', 1 + i / 200)),
      );

      drawThreats(baseOptions(ctx, threats));

      expect(__bucketCountForTest()).toBeLessThanOrEqual(6);
    });

    it('quantizes alpha so a fading burst cannot explode the bucket count', () => {
      const { ctx } = stubContext();
      const threats = Array.from({ length: 200 }, (_, i) =>
        makeRenderable(makeThreat(`t${i}`), 0.5, 0.01 + (i / 200) * 0.99),
      );

      drawThreats(baseOptions(ctx, threats));

      expect(__bucketCountForTest()).toBeLessThanOrEqual(16);
    });
  });

  describe('frame behaviour', () => {
    it('clears the canvas each frame', () => {
      const { ctx, calls } = stubContext();
      drawThreats(baseOptions(ctx, [makeRenderable(makeThreat('a'))]));
      expect(calls.clearRect).toBe(1);
    });

    it('does not leak buckets across frames', () => {
      const { ctx } = stubContext();

      drawThreats(baseOptions(ctx, [makeRenderable(makeThreat('a', 'low'))]));
      expect(__bucketCountForTest()).toBe(1);

      // A different colour on the next frame must replace, not accumulate.
      drawThreats(baseOptions(ctx, [makeRenderable(makeThreat('b', 'critical'))]));
      expect(__bucketCountForTest()).toBe(1);
    });

    it('skips fully faded threats entirely', () => {
      const { ctx } = stubContext();
      drawThreats(baseOptions(ctx, [makeRenderable(makeThreat('a'), 0.5, 0)]));
      expect(__bucketCountForTest()).toBe(0);
    });

    it('fades origin markers in step with their threat instead of popping', () => {
      // Regression: decorations were batched at a flat opacity, ignoring the
      // threat's fade alpha. A newly-arrived attack's arc ramped up over 400ms
      // while its origin dot appeared instantly at full strength — and on
      // removal the dot stayed lit until the threat was reaped, then vanished.
      // On a streaming feed that is every add and every removal.
      const alphasUsed = (alpha: number) => {
        const { ctx } = stubContext();
        const seen: number[] = [];
        // globalAlpha is a plain property on the stub, so record what fill() sees.
        Object.defineProperty(ctx, 'fillStyle', { value: '', writable: true });
        const originalFill = ctx.fill.bind(ctx);
        (ctx as unknown as { fill: () => void }).fill = () => {
          seen.push(ctx.globalAlpha);
          originalFill();
        };
        drawThreats(baseOptions(ctx, [makeRenderable(makeThreat('a'), 0.5, alpha)]));
        return seen;
      };

      const faint = alphasUsed(0.25);
      const full = alphasUsed(1);

      // Some fill during the fade must be dimmer than the same fill at full opacity.
      expect(Math.max(...faint)).toBeLessThan(Math.max(...full));
      // And it must scale roughly with the fade, not sit at a constant.
      expect(Math.max(...faint)).toBeLessThan(0.5);
    });

    it('keeps decoration draw calls bounded when many threats fade at once', () => {
      // Alpha-bucketing decorations must not reintroduce per-threat draw calls.
      const { ctx, calls } = stubContext();
      const threats = Array.from({ length: 300 }, (_, i) =>
        makeRenderable(makeThreat(`t${i}`), 0.95, 0.01 + (i / 300) * 0.99),
      );

      drawThreats(baseOptions(ctx, threats));

      expect(calls.stroke + calls.fill).toBeLessThan(250);
    });

    it('draws nothing but the clear for an empty threat list', () => {
      const { ctx, calls } = stubContext();
      drawThreats(baseOptions(ctx, []));
      expect(calls.stroke + calls.fill).toBe(0);
      expect(calls.clearRect).toBe(1);
    });

    it('restores the composite mode it found', () => {
      const { ctx } = stubContext();
      ctx.globalCompositeOperation = 'source-over';
      drawThreats(baseOptions(ctx, [makeRenderable(makeThreat('a'))]));
      expect(ctx.globalCompositeOperation).toBe('source-over');
      expect(ctx.globalAlpha).toBe(1);
    });

    it('falls back to the medium colour for an unknown custom severity', () => {
      const { ctx } = stubContext();
      // A bogus colour string makes Canvas silently skip the stroke, so the
      // threat would vanish. It must fall back instead.
      drawThreats(baseOptions(ctx, [makeRenderable(makeThreat('a', 'artisanal'))]));
      expect(__bucketCountForTest()).toBe(1);
    });
  });

  describe('renderThreat hook', () => {
    it('receives the threat, its geometry, and animation state', () => {
      const { ctx } = stubContext();
      const renderThreat = vi.fn();
      const threat = makeThreat('a');

      drawThreats({
        ...baseOptions(ctx, [makeRenderable(threat, 0.25, 0.8)]),
        renderThreat,
      });

      expect(renderThreat).toHaveBeenCalledOnce();
      const info = renderThreat.mock.calls[0]?.[1] as never as {
        threat: Threat; progress: number; alpha: number; points: Float32Array;
      };
      expect(info.threat.id).toBe('a');
      expect(info.progress).toBe(0.25);
      expect(info.alpha).toBe(0.8);
      expect(info.points.length).toBe(49 * 2);
    });

    it('skips the built-in renderer when the hook returns true', () => {
      const { ctx } = stubContext();

      drawThreats({
        ...baseOptions(ctx, [makeRenderable(makeThreat('a'))]),
        renderThreat: () => true,
      });

      expect(__bucketCountForTest()).toBe(0);
    });

    it('falls through to the built-in renderer when the hook returns false', () => {
      const { ctx } = stubContext();

      drawThreats({
        ...baseOptions(ctx, [makeRenderable(makeThreat('a'))]),
        renderThreat: () => false,
      });

      expect(__bucketCountForTest()).toBe(1);
    });

    it('survives a throwing hook and reports it once', () => {
      const { ctx } = stubContext();
      const onError = vi.fn();
      const threats = Array.from({ length: 5 }, (_, i) => makeRenderable(makeThreat(`t${i}`)));

      expect(() =>
        drawThreats({
          ...baseOptions(ctx, threats),
          renderThreat: () => {
            throw new Error('hook exploded');
          },
          onError,
        }),
      ).not.toThrow();

      // Disabled after the first throw, and the built-in renderer took over.
      expect(onError).toHaveBeenCalledOnce();
      expect(__bucketCountForTest()).toBe(1);
    });

    it('wraps the hook in save/restore so it cannot corrupt later threats', () => {
      const { ctx } = stubContext();
      const save = ctx.save as unknown as ReturnType<typeof vi.fn>;
      const restore = ctx.restore as unknown as ReturnType<typeof vi.fn>;

      drawThreats({
        ...baseOptions(ctx, [makeRenderable(makeThreat('a'))]),
        renderThreat: (c) => {
          c.globalAlpha = 0; // would blank every subsequent threat if it leaked
          return true;
        },
      });

      expect(save).toHaveBeenCalledOnce();
      expect(restore).toHaveBeenCalledOnce();
    });
  });
});
