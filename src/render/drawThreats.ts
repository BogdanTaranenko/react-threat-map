/**
 * The animated threat layer — the only thing that runs every frame.
 *
 * The performance strategy, in one place (DECISIONS.md §2 has the reasoning):
 *
 * - **Geometry is precomputed.** Arcs are built once per layout by `buildArc`
 *   and cached; this module only *walks* the resulting buffers.
 * - **Draw calls are batched by style.** Threats are bucketed by
 *   `(color, rounded width)` and each bucket accumulates every member's geometry
 *   into one `Path2D`, then issues one `stroke()`. A frame costs a number of draw
 *   calls proportional to the number of distinct styles — not to the number of
 *   threats. 500 threats and 50 threats cost about the same.
 * - **Glow is a double-stroke, not `shadowBlur`.** `shadowBlur` is per-stroke and
 *   brutally expensive; drawing each bucket wide-and-faint then narrow-and-bright
 *   looks the same on a line and is roughly an order of magnitude cheaper.
 * - **The per-threat path allocates nothing.** Head positions are written into a
 *   module-level scratch buffer instead of returning `{x, y}`, which at 500
 *   threats × 60 fps would otherwise be ~30k throwaway objects per second. Per
 *   *bucket* we do allocate a few `Path2D`s each frame — those cannot be reset
 *   and must be rebuilt — but that is a couple of dozen objects, not tens of
 *   thousands.
 *
 * @packageDocumentation
 */

import type { LineStyleConfig, ThreatMapTheme, ThreatRenderer, Threat } from '../types.js';
import type { ArcGeometry } from './path.js';
import { pointAt } from './path.js';

/** A threat paired with its precomputed geometry and animation state. */
export interface RenderableThreat<TMeta = unknown> {
  readonly threat: Threat<TMeta>;
  readonly geometry: ArcGeometry;
  /** Head position along the path, `0`–`1`, easing already applied. */
  readonly progress: number;
  /** Fade-in/fade-out opacity, `0`–`1`. */
  readonly alpha: number;
}

/** Everything {@link drawThreats} needs. */
export interface DrawThreatsOptions<TMeta = unknown> {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly threats: readonly RenderableThreat<TMeta>[];
  readonly theme: ThreatMapTheme;
  readonly line: LineStyleConfig;
  readonly pixelRatio: number;
  readonly elapsed: number;
  readonly renderThreat?: ThreatRenderer<TMeta> | undefined;
  readonly onError?: ((message: string, cause: unknown) => void) | undefined;
}

/** One style bucket's accumulated geometry. @internal */
interface Bucket {
  readonly color: string;
  readonly width: number;
  /** Opacity shared by every threat in this bucket. */
  readonly alpha: number;
  /** Full arcs, drawn faint. */
  readonly track: Path2D;
  /** The lit segment behind each head. */
  readonly trail: Path2D;
  /** Head dots, as filled circles. */
  readonly heads: Path2D;
  hasTrack: boolean;
  hasTrail: boolean;
  hasHeads: boolean;
}

/**
 * Rebuilt each frame. `Path2D` has no clear operation, so its contents cannot be
 * reused across frames — and once the paths must be reallocated anyway, keeping
 * the bucket objects alive saves nothing worth the stale-state risk.
 */
const buckets = new Map<string, Bucket>();

/**
 * Origin markers and impact ripples, accumulated per frame.
 *
 * Both bucket on the threat's fade alpha for the same reason the line buckets do:
 * a marker drawn at a flat opacity would pop into existence at full strength
 * while its own arc is still fading in, and would still be at full strength the
 * instant its arc finishes fading out. On a streaming feed that is every single
 * add and removal.
 *
 * Origins share one colour, so all markers at a given alpha collapse into one
 * fill. Ripples additionally vary by expansion phase, so they key on both.
 */
interface Decorations {
  /** Origin marker paths keyed by quantized alpha step. */
  readonly origins: Map<number, Path2D>;
  /** Ripple paths keyed by `phaseStep:alphaStep`. */
  readonly impacts: Map<string, Path2D>;
}

/** Fraction of the path over which a landing head's ripple plays out. */
const IMPACT_WINDOW = 0.12;

/** Quantization steps for ripple fade, bounding impact draw calls. */
const IMPACT_STEPS = 6;

/** Peak ripple radius in CSS pixels, before intensity scaling. */
const IMPACT_RADIUS = 9;

/** Scratch for `pointAt`, so the head position costs no allocation. */
const scratch = new Float32Array(2);

/**
 * Quantization steps for opacity when bucketing.
 *
 * Fading threats hold a continuous alpha, which would give each its own bucket
 * and defeat batching exactly when a burst of new threats arrives. Snapping to
 * 16 steps is invisible on a 400 ms fade and keeps bucket counts low.
 */
const ALPHA_STEPS = 16;

/**
 * Render one frame of the threat layer.
 *
 * @param options - See {@link DrawThreatsOptions}.
 */
export function drawThreats<TMeta>(options: DrawThreatsOptions<TMeta>): void {
  const { ctx, width, height, threats, theme, line, renderThreat, onError } = options;

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  buckets.clear();
  const decorations: Decorations = { origins: new Map(), impacts: new Map() };

  let hookFailed = false;

  for (const renderable of threats) {
    if (renderable.alpha <= 0) continue;

    if (renderThreat && !hookFailed) {
      const handled = runHook(options, renderable, () => {
        hookFailed = true;
      });
      if (handled) continue;
    }

    accumulate(renderable, theme, line);
    accumulateDecorations(renderable, line, decorations);
  }

  paint(ctx, line, theme);
  paintDecorations(ctx, theme, decorations);

  if (hookFailed) {
    onError?.('renderThreat threw; falling back to the built-in renderer.', undefined);
  }
}

/**
 * Run a consumer's `renderThreat`.
 *
 * Wrapped in save/restore so a hook that leaves `globalAlpha` at 0 or a
 * transform applied cannot corrupt every threat drawn after it.
 *
 * @returns `true` if the hook fully handled the threat.
 */
function runHook<TMeta>(
  options: DrawThreatsOptions<TMeta>,
  renderable: RenderableThreat<TMeta>,
  markFailed: () => void,
): boolean {
  const { ctx, theme, line, pixelRatio, elapsed, renderThreat } = options;

  ctx.save();
  try {
    const handled = renderThreat!(ctx, {
      threat: renderable.threat,
      points: renderable.geometry.points,
      progress: renderable.progress,
      alpha: renderable.alpha,
      theme,
      line,
      pixelRatio,
      elapsed,
    });
    return handled === true;
  } catch {
    markFailed();
    return false;
  } finally {
    ctx.restore();
  }
}

/**
 * Resolve a threat's stroke color.
 *
 * Custom severity strings are supported by simply looking them up; an
 * unrecognized one falls back to `medium` rather than rendering an invalid
 * color (which Canvas silently ignores, making the threat vanish).
 */
function colorFor(threat: Threat<unknown>, theme: ThreatMapTheme): string {
  return theme.severityColors[threat.severity] ?? theme.severityColors.medium ?? '#fbbf24';
}

/**
 * Assign a threat to a style bucket and append its geometry.
 *
 * Width is quantized to 0.5 px before bucketing. Without quantization, the
 * continuous `intensity` scale would give nearly every threat a unique width and
 * therefore its own bucket — collapsing batching back into one draw call per
 * threat, which is the exact thing this design exists to avoid. Half a pixel is
 * below the visible threshold and keeps buckets in the low tens.
 */
function accumulate(renderable: RenderableThreat<unknown>, theme: ThreatMapTheme, line: LineStyleConfig): void {
  const { threat, geometry, progress, alpha } = renderable;

  const color = colorFor(threat, theme);
  const rawWidth = line.width * threat.intensity;
  const width = Math.max(0.25, Math.round(rawWidth * 2) / 2);

  // Alpha is quantized into the key too: mid-fade threats would otherwise each
  // land in their own bucket. 16 steps is imperceptible across a fade.
  const alphaStep = Math.max(1, Math.round(alpha * ALPHA_STEPS));
  const key = `${color}|${width}|${alphaStep}`;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      color,
      width,
      alpha: alphaStep / ALPHA_STEPS,
      track: new Path2D(),
      trail: new Path2D(),
      heads: new Path2D(),
      hasTrack: false,
      hasTrail: false,
      hasHeads: false,
    };
    buckets.set(key, bucket);
  }

  appendPolyline(bucket.track, geometry, 0, 1);
  bucket.hasTrack = true;

  if (line.trailLength > 0 && progress > 0) {
    const start = Math.max(0, progress - line.trailLength);
    appendPolyline(bucket.trail, geometry, start, progress);
    bucket.hasTrail = true;
  }

  if (line.headRadius > 0) {
    pointAt(geometry, progress, scratch);
    const radius = line.headRadius * Math.max(1, Math.sqrt(threat.intensity));
    bucket.heads.moveTo((scratch[0] as number) + radius, scratch[1] as number);
    bucket.heads.arc(scratch[0] as number, scratch[1] as number, radius, 0, Math.PI * 2);
    bucket.hasHeads = true;
  }
}

/**
 * Collect a threat's origin marker and, if its head is landing, its impact ripple.
 *
 * Both are additions to the frame's decoration paths rather than immediate draws,
 * so the whole map's origins cost one fill and its ripples at most
 * {@link IMPACT_STEPS} strokes.
 */
function accumulateDecorations(
  renderable: RenderableThreat<unknown>,
  line: LineStyleConfig,
  decorations: Decorations,
): void {
  const { geometry, progress, threat, alpha } = renderable;
  const { points } = geometry;

  // Same quantization as the line buckets, so a marker fades in step with the
  // arc it belongs to instead of popping.
  const alphaStep = Math.max(1, Math.round(alpha * ALPHA_STEPS));

  if (line.showOrigin) {
    // A static dot at the tail, so a region reads as an attack source even while
    // its head is mid-flight or between loops.
    const radius = Math.max(1, 1.5 * Math.sqrt(threat.intensity));
    const x = points[0] as number;
    const y = points[1] as number;

    let origins = decorations.origins.get(alphaStep);
    if (!origins) {
      origins = new Path2D();
      decorations.origins.set(alphaStep, origins);
    }
    origins.moveTo(x + radius, y);
    origins.arc(x, y, radius, 0, Math.PI * 2);
  }

  if (!line.showImpact || progress < 1 - IMPACT_WINDOW) return;

  // Ripple phase: 0 as the head enters the window, 1 exactly on arrival.
  const phase = (progress - (1 - IMPACT_WINDOW)) / IMPACT_WINDOW;
  const phaseStep = Math.min(IMPACT_STEPS - 1, Math.floor(phase * IMPACT_STEPS));

  const last = points.length - 2;
  const x = points[last] as number;
  const y = points[last + 1] as number;
  const radius = Math.max(0.5, phase * IMPACT_RADIUS * Math.sqrt(threat.intensity));

  const key = `${phaseStep}:${alphaStep}`;
  let path = decorations.impacts.get(key);
  if (!path) {
    path = new Path2D();
    decorations.impacts.set(key, path);
  }
  path.moveTo(x + radius, y);
  path.arc(x, y, radius, 0, Math.PI * 2);
}

/** Draw the frame's origin markers and impact ripples. */
function paintDecorations(ctx: CanvasRenderingContext2D, theme: ThreatMapTheme, decorations: Decorations): void {
  if (decorations.origins.size > 0) {
    ctx.fillStyle = theme.originColor;
    for (const [alphaStep, path] of decorations.origins) {
      ctx.globalAlpha = 0.9 * (alphaStep / ALPHA_STEPS);
      ctx.fill(path);
    }
  }

  if (decorations.impacts.size > 0) {
    const previousComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = theme.impactColor;
    ctx.lineWidth = 1;

    for (const [key, path] of decorations.impacts) {
      const [phaseStep, alphaStep] = key.split(':');
      // Expand and fade together, so the ripple dissipates rather than snapping
      // off — then scale the whole thing by the threat's own fade alpha.
      const phase = (Number(phaseStep) + 0.5) / IMPACT_STEPS;
      const fade = Number(alphaStep) / ALPHA_STEPS;
      ctx.globalAlpha = (1 - phase) * 0.7 * fade;
      ctx.stroke(path);
    }

    ctx.globalCompositeOperation = previousComposite;
  }

  ctx.globalAlpha = 1;
}

/**
 * Append the portion of an arc between two progress values to a path.
 *
 * Walks the precomputed polyline and emits only whole segments within range,
 * plus interpolated endpoints — so a trail starts and ends exactly where the
 * animation says, not at the nearest vertex.
 *
 * `breakAt` splits the polyline at an antimeridian seam: the path lifts the pen
 * there rather than streaking a line across the whole map.
 */
function appendPolyline(path: Path2D, geometry: ArcGeometry, from: number, to: number): void {
  const { points, distances, length, breakAt } = geometry;
  const count = distances.length;
  if (count < 2 || length <= 0) return;

  const startDistance = from * length;
  const endDistance = to * length;

  let started = false;

  for (let i = 0; i < count; i++) {
    const distance = distances[i] as number;

    if (distance < startDistance) {
      // Still before the window; the next in-range vertex will open the path.
      continue;
    }
    if (distance > endDistance) break;

    const x = points[i * 2] as number;
    const y = points[i * 2 + 1] as number;

    if (!started) {
      // Interpolate the exact entry point rather than snapping to this vertex.
      pointAt(geometry, from, scratch);
      path.moveTo(scratch[0] as number, scratch[1] as number);
      started = true;
    }

    if (i === breakAt) {
      // The seam: start a new subpath on the far side of the map.
      path.moveTo(x, y);
      continue;
    }
    path.lineTo(x, y);
  }

  if (!started) {
    // The whole window fell between two vertices — draw the chord for it.
    pointAt(geometry, from, scratch);
    path.moveTo(scratch[0] as number, scratch[1] as number);
  }

  pointAt(geometry, to, scratch);
  path.lineTo(scratch[0] as number, scratch[1] as number);
}

/**
 * Issue the frame's draw calls: at most five per bucket, regardless of how many
 * threats landed in it.
 */
function paint(ctx: CanvasRenderingContext2D, line: LineStyleConfig, theme: ThreatMapTheme): void {
  // Additive blending makes overlapping threats brighten rather than muddy,
  // which is what makes a busy corridor read as busy.
  const previousComposite = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';

  for (const bucket of buckets.values()) {
    const alpha = bucket.alpha;

    if (bucket.hasTrack && line.trackOpacity > 0) {
      ctx.globalAlpha = line.trackOpacity * alpha;
      ctx.strokeStyle = bucket.color;
      ctx.lineWidth = bucket.width;
      ctx.stroke(bucket.track);
    }

    if (bucket.hasTrail) {
      // Fake glow: one wide faint pass under one narrow bright pass.
      if (line.glow > 0) {
        ctx.globalAlpha = line.trailOpacity * alpha * 0.22 * line.glow;
        ctx.strokeStyle = bucket.color;
        ctx.lineWidth = bucket.width * 4;
        ctx.stroke(bucket.trail);
      }

      ctx.globalAlpha = line.trailOpacity * alpha;
      ctx.strokeStyle = bucket.color;
      ctx.lineWidth = bucket.width;
      ctx.stroke(bucket.trail);
    }

    if (bucket.hasHeads) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = theme.headColor ?? bucket.color;
      ctx.fill(bucket.heads);
    }
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = previousComposite;
}

/**
 * The number of style buckets the last frame used.
 *
 * This is the load-bearing performance number for the whole renderer: it is
 * proportional to the frame's draw-call count, and it must stay flat as threat
 * count grows. Exposed so tests can assert exactly that.
 *
 * @internal
 */
export function __bucketCountForTest(): number {
  return buckets.size;
}
