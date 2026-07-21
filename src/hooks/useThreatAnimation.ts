/**
 * Threat lifecycle and the animation loop.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';

import type {
  AnimationConfig,
  GeoProjectionLike,
  LineStyleConfig,
  ThreatMapTheme,
  ThreatRenderer,
  Threat,
} from '../types.js';
import { buildArc, type ArcGeometry } from '../render/path.js';
import { drawThreats, type RenderableThreat } from '../render/drawThreats.js';
import { resolveEasing } from '../render/easing.js';
import { hitTest, type HitCandidate } from '../render/hitTest.js';

/** A threat's live animation state. @internal */
interface Entry<TMeta> {
  threat: Threat<TMeta>;
  geometry: ArcGeometry | null;
  /** Phase offset in `[0, 1)`, so threats do not all launch in lockstep. */
  readonly phase: number;
  /** When this threat first appeared, for fade-in. */
  readonly bornAt: number;
  /** When it left the `attacks` array, for fade-out. `null` while alive. */
  diedAt: number | null;
}

/** Inputs to {@link useThreatAnimation}. */
export interface ThreatAnimationOptions<TMeta> {
  readonly canvas: RefObject<HTMLCanvasElement | null>;
  readonly threats: readonly Threat<TMeta>[];
  readonly projection: GeoProjectionLike | null;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly theme: ThreatMapTheme;
  readonly line: LineStyleConfig;
  readonly animation: AnimationConfig;
  readonly renderThreat?: ThreatRenderer<TMeta> | undefined;
  readonly onError?: ((message: string, cause: unknown) => void) | undefined;
}

/**
 * Deterministic phase offset from a threat id.
 *
 * `Math.random()` would reshuffle every threat's phase on each re-render, making
 * the whole map twitch whenever the feed updates. Hashing the id instead means a
 * threat's phase is a stable function of its identity: it keeps its rhythm for
 * as long as it exists, and two threats with different ids still get unrelated
 * phases. FNV-1a is used for being short and well-distributed on short strings.
 */
function phaseFor(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

/** What {@link useThreatAnimation} hands back to the canvas. */
export interface ThreatAnimationApi<TMeta> {
  /**
   * The threat at a pointer position, or `null`.
   *
   * Lives here rather than in the canvas component because the arc geometry it
   * needs is already built and cached by this hook. Rebuilding arcs per pointer
   * event would mean ~24k projections *per mouse pixel* at 500 threats.
   *
   * @param x - Pointer x in CSS pixels, relative to the canvas.
   * @param y - Pointer y in CSS pixels, relative to the canvas.
   */
  readonly pickAt: (x: number, y: number) => Threat<TMeta> | null;
}

/**
 * Drive the threat layer.
 *
 * Owns three things React should not:
 *
 * - **The entry map**, which outlives `attacks` so a removed attack can fade out
 *   rather than vanish. Kept in a ref because it changes 60× a second and no
 *   render should result.
 * - **The rAF loop**, which reads the latest props from a ref. Without that, the
 *   loop would have to be torn down and restarted on every prop change — and a
 *   streaming feed changes props constantly.
 * - **The arc geometry cache**, rebuilt only when the projection or arc shape
 *   changes. Hit testing reads it too, via {@link ThreatAnimationApi.pickAt}.
 *
 * When animation is disabled, no loop is scheduled at all; the layer is painted
 * once per change. The component then costs nothing per frame.
 */
export function useThreatAnimation<TMeta>(options: ThreatAnimationOptions<TMeta>): ThreatAnimationApi<TMeta> {
  const entries = useRef(new Map<string, Entry<TMeta>>());
  const latest = useRef(options);
  latest.current = options;

  const startedAt = useRef<number>(0);
  const frame = useRef<number>(0);

  // Sync the entry map with the current threat set, and rebuild geometry when
  // the projection or arc shape changes. Runs on render, not per frame.
  const { threats, projection, line, width, height } = options;
  useEffect(() => {
    const map = entries.current;
    const now = performance.now();
    const seen = new Set<string>();

    for (const threat of threats) {
      seen.add(threat.id);
      const existing = map.get(threat.id);

      if (existing) {
        existing.threat = threat;
        // Returned from the dead before its fade-out finished: cancel the fade.
        existing.diedAt = null;
      } else {
        map.set(threat.id, {
          threat,
          geometry: null,
          phase: phaseFor(threat.id),
          bornAt: now,
          diedAt: null,
        });
      }
    }

    for (const [id, entry] of map) {
      if (!seen.has(id) && entry.diedAt === null) entry.diedAt = now;
    }
  }, [threats]);

  // Geometry depends on projection and arc shape, not on the animation clock, so
  // it is rebuilt here rather than in the loop. This is the precompute that
  // keeps per-frame cost proportional to style buckets — see DECISIONS.md §2.
  useEffect(() => {
    if (!projection) return;
    // Cap arc height at a third of the viewport, so an intercontinental arc bows
    // dramatically but still lands on the map instead of being clipped by the
    // top edge. Derived from the viewport rather than configured, because the
    // constraint being expressed is "stay visible", which is a property of the
    // box, not a taste setting.
    const maxLift = height > 0 ? height / 3 : Infinity;
    for (const entry of entries.current.values()) {
      entry.geometry = buildArc(
        entry.threat.from,
        entry.threat.to,
        projection,
        line.curvature,
        line.segments,
        maxLift,
      );
    }
  }, [projection, line.curvature, line.segments, threats, width, height]);

  useEffect(() => {
    const canvas = options.canvas.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      options.onError?.('Could not acquire a 2D canvas context; the threat layer will not render.', undefined);
      return;
    }

    if (startedAt.current === 0) startedAt.current = performance.now();

    const renderFrame = (now: number) => {
      const current = latest.current;
      const elapsed = now - startedAt.current;

      // `now` comes from rAF, which shares performance.now()'s time origin — so
      // it is directly comparable to the bornAt/diedAt stamps.
      const renderables = collect(entries.current, current, elapsed, now);

      ctx.setTransform(current.pixelRatio, 0, 0, current.pixelRatio, 0, 0);
      drawThreats({
        ctx,
        width: current.width,
        height: current.height,
        threats: renderables,
        theme: current.theme,
        line: current.line,
        pixelRatio: current.pixelRatio,
        elapsed,
        renderThreat: current.renderThreat,
        onError: current.onError,
      });

      if (current.animation.enabled) {
        frame.current = requestAnimationFrame(renderFrame);
      }
    };

    frame.current = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(frame.current);
    // Every visual input is a dependency, which matters most when animation is
    // *disabled*: there is no loop to pick up a change, so a theme edit would
    // never repaint without this. While animated, re-arming rAF on a prop change
    // is a cancel plus a schedule — cheap, and it keeps both modes on one path.
    //
    // These identities are stable: ThreatMap memoizes every resolved config, so
    // this does not re-fire per render.
  }, [
    options.canvas,
    width,
    height,
    options.pixelRatio,
    options.animation,
    options.theme,
    options.line,
    options.renderThreat,
    threats,
    projection,
  ]);

  const pickAt = useCallback(
    (x: number, y: number): Threat<TMeta> | null => {
      const current = latest.current;
      return hitTest(candidates(entries.current), x, y, current.line.width);
    },
    [],
  );

  return { pickAt };
}

/** Live threats with geometry, as hit-test candidates. Skips anything mid-fade-out. */
function* candidates<TMeta>(map: Map<string, Entry<TMeta>>): Generator<HitCandidate<Threat<TMeta>>> {
  for (const entry of map.values()) {
    if (!entry.geometry || entry.diedAt !== null) continue;
    yield { value: entry.threat, geometry: entry.geometry, intensity: entry.threat.intensity };
  }
}

/**
 * Build this frame's renderable list, and reap threats whose fade-out finished.
 *
 * Mutates the entry map in place: this runs 60× a second and copying it would
 * allocate on every frame.
 */
function collect<TMeta>(
  map: Map<string, Entry<TMeta>>,
  options: ThreatAnimationOptions<TMeta>,
  elapsed: number,
  now: number,
): RenderableThreat<TMeta>[] {
  const { animation } = options;
  const easing = resolveEasing(animation.easing);

  const out: RenderableThreat<TMeta>[] = [];
  let expired: string[] | null = null;

  for (const [id, entry] of map) {
    if (!entry.geometry) continue;

    const alpha = alphaFor(entry, animation, now);
    if (alpha <= 0 && entry.diedAt !== null) {
      // Fade-out complete; stop tracking it.
      (expired ??= []).push(id);
      continue;
    }

    out.push({
      threat: entry.threat,
      geometry: entry.geometry,
      progress: easing(progressFor(entry, animation, elapsed)),
      alpha,
    });
  }

  if (expired) {
    for (const id of expired) map.delete(id);
  }
  return out;
}

/** Head position along the path, before easing. */
function progressFor<TMeta>(entry: Entry<TMeta>, animation: AnimationConfig, elapsed: number): number {
  if (!animation.enabled) return 1;

  const stagger = Math.max(0, Math.min(1, animation.stagger));
  const cycles = (elapsed / 1000) * animation.speed + entry.phase * stagger;

  if (animation.loop) return cycles % 1;
  return Math.min(1, cycles);
}

/** Fade-in/fade-out opacity. */
function alphaFor<TMeta>(entry: Entry<TMeta>, animation: AnimationConfig, now: number): number {
  if (entry.diedAt !== null) {
    if (animation.fadeOut <= 0) return 0;
    return Math.max(0, 1 - (now - entry.diedAt) / animation.fadeOut);
  }
  if (animation.fadeIn <= 0) return 1;
  return Math.min(1, (now - entry.bornAt) / animation.fadeIn);
}
