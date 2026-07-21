/**
 * The animated threat canvas.
 *
 * @packageDocumentation
 */

// `MouseEvent` is aliased because the unqualified name is the DOM event, which
// is what the public `onThreatClick`/`onThreatHover` signatures hand back via
// `event.nativeEvent`. These handlers take the React synthetic one.
import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';

import type {
  AnimationConfig,
  GeoProjectionLike,
  LineStyleConfig,
  ThreatMapTheme,
  ThreatRenderer,
  Threat,
} from '../types.js';
import { useThreatAnimation } from '../hooks/useThreatAnimation.js';

/** Props for {@link ThreatCanvas}. @internal */
export interface ThreatCanvasProps<TMeta> {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly projection: GeoProjectionLike | null;
  readonly threats: readonly Threat<TMeta>[];
  readonly theme: ThreatMapTheme;
  readonly line: LineStyleConfig;
  readonly animation: AnimationConfig;
  readonly renderThreat?: ThreatRenderer<TMeta> | undefined;
  readonly onThreatClick?: ((threat: Threat<TMeta>, event: MouseEvent) => void) | undefined;
  readonly onThreatHover?: ((threat: Threat<TMeta> | null, event: MouseEvent) => void) | undefined;
  readonly onError?: ((message: string, cause: unknown) => void) | undefined;
}

/**
 * Draws the animated threats above the base map.
 *
 * @internal
 */
export function ThreatCanvas<TMeta>(props: ThreatCanvasProps<TMeta>): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hovered = useRef<string | null>(null);

  const {
    width,
    height,
    pixelRatio,
    projection,
    threats,
    theme,
    line,
    animation,
    renderThreat,
    onThreatClick,
    onThreatHover,
    onError,
  } = props;

  const { pickAt } = useThreatAnimation({
    canvas: canvasRef,
    threats,
    projection,
    width,
    height,
    pixelRatio,
    theme,
    line,
    animation,
    renderThreat,
    onError,
  });

  const interactive = Boolean(onThreatClick ?? onThreatHover);

  /** Map a pointer event to the threat under it, if any. */
  const pick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>): Threat<TMeta> | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      // getBoundingClientRect gives CSS pixels, which is the space the cached
      // arc geometry is already in — no pixelRatio conversion needed.
      const rect = canvas.getBoundingClientRect();
      return pickAt(event.clientX - rect.left, event.clientY - rect.top);
    },
    [pickAt],
  );

  const handleMove = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!onThreatHover) return;
      const threat = pick(event);
      const id = threat?.id ?? null;
      // Fire only on change, not on every mousemove — a consumer setting state
      // in this handler would otherwise re-render on every pointer pixel.
      if (id === hovered.current) return;
      hovered.current = id;
      onThreatHover(threat, event.nativeEvent);
    },
    [onThreatHover, pick],
  );

  const handleLeave = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!onThreatHover || hovered.current === null) return;
      hovered.current = null;
      onThreatHover(null, event.nativeEvent);
    },
    [onThreatHover],
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!onThreatClick) return;
      const threat = pick(event);
      if (threat) onThreatClick(threat, event.nativeEvent);
    },
    [onThreatClick, pick],
  );

  return (
    <canvas
      ref={canvasRef}
      width={Math.max(1, Math.round(width * pixelRatio))}
      height={Math.max(1, Math.round(height * pixelRatio))}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        // Without handlers the canvas must not eat pointer events aimed at
        // whatever the consumer layered underneath.
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      onMouseMove={interactive ? handleMove : undefined}
      onMouseLeave={interactive ? handleLeave : undefined}
      onClick={interactive ? handleClick : undefined}
      aria-hidden="true"
    />
  );
}
