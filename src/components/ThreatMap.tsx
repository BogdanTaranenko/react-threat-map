/**
 * The `<ThreatMap>` component.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from 'react';

import type { Attack, ThreatMapError, ThreatMapProps, Threat } from '../types.js';
import { defaultAnimation, defaultLineStyle, defaultRegions, defaultTheme } from '../config.js';
import { aggregateAttacks } from '../aggregation/aggregate.js';
import { aspectRatioFor, createProjection, defaultHeightFor } from '../render/projection.js';
import { useElementSize } from '../hooks/useElementSize.js';
import { useGeoData } from '../hooks/useGeoData.js';
import { usePixelRatio } from '../hooks/usePixelRatio.js';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import { useStableConfig } from '../utils/stable.js';
import { BaseMapCanvas } from './BaseMapCanvas.js';
import { ThreatCanvas } from './ThreatCanvas.js';

/**
 * A world map with animated cyberattack threats drawn over it.
 *
 * In the simplest case, pass attacks and nothing else — the map sizes itself to
 * its container, loads its own geography, aggregates by origin region, and
 * animates:
 *
 * ```tsx
 * <ThreatMap attacks={[{ from: 'CN', to: 'US-CA', severity: 'high' }]} />
 * ```
 *
 * Every layer is then customizable via props. See {@link ThreatMapProps}, and
 * the README for the full guide.
 *
 * **Layout**: the component renders a positioned wrapper containing two stacked
 * canvases. Give the wrapper a size via `style`/`className`, or pass explicit
 * `width`/`height`. With neither, it fills its container's width and derives a
 * height from the projection's aspect ratio.
 *
 * @example Streaming feed with custom theme and state borders
 * ```tsx
 * <ThreatMap
 *   attacks={attacks}
 *   regions={{ showStates: true }}
 *   theme={{ ocean: '#000', severityColors: { critical: '#f0f' } }}
 *   animation={{ speed: 1.2 }}
 *   onThreatClick={(threat) => console.log(threat.count, 'attacks from', threat.fromRegion.name)}
 * />
 * ```
 */
export function ThreatMap<TMeta = unknown>(props: ThreatMapProps<TMeta>): JSX.Element {
  const {
    attacks,
    width: widthProp,
    height: heightProp,
    projection: projectionProp = 'naturalEarth1',
    geo: geoProp,
    renderThreat,
    renderRegion,
    onThreatClick,
    onThreatHover,
    onError,
    className,
    style,
    ariaLabel = 'Cyberattack threat map',
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);

  /* ------------------------------ configuration ----------------------------- */

  // Configs resolve to references that change only when their *values* do — see
  // useStableConfig. Keying on the caller's object identity instead would be
  // useless for the way these props are almost always written (`theme={{...}}`
  // inline), and would re-rasterize the base map on every render of any
  // component that re-renders — which a streaming feed does constantly.
  const themeOverrides = useMemo(() => {
    // severityColors is the one nested object, so a partial override of it must
    // not wipe the sibling severities the consumer did not mention.
    if (!props.theme?.severityColors) return props.theme;
    return { ...props.theme, severityColors: { ...defaultTheme.severityColors, ...props.theme.severityColors } };
  }, [props.theme]);

  const theme = useStableConfig(defaultTheme, themeOverrides);
  const line = useStableConfig(defaultLineStyle, props.line);
  const regions = useStableConfig(defaultRegions, props.regions);

  const reducedMotion = useReducedMotion();
  const baseAnimation = useStableConfig(defaultAnimation, props.animation);
  const animation = useMemo(
    () =>
      // Someone who has asked their OS for less motion should not be handed a
      // screen of racing lines. The arcs still render; they just hold still.
      baseAnimation.respectReducedMotion && reducedMotion ? { ...baseAnimation, enabled: false } : baseAnimation,
    [baseAnimation, reducedMotion],
  );

  /* -------------------------------- sizing --------------------------------- */

  const measured = useElementSize(containerRef, widthProp === undefined || heightProp === undefined);
  const pixelRatio = usePixelRatio();

  const width = widthProp ?? measured?.width ?? 0;
  // Prefer what the container actually measures — that is what respects a
  // consumer's own CSS height. The aspect-ratio fallback covers the case where
  // nothing has measured yet, or where there is no ResizeObserver at all (SSR,
  // jsdom); without it a map given only a width would never paint.
  const height =
    heightProp ?? (measured && measured.height > 0 ? measured.height : width > 0 ? defaultHeightFor(projectionProp, width) : 0);

  const projection = useMemo(
    () => (width > 0 && height > 0 ? createProjection(projectionProp, width, height) : null),
    [projectionProp, width, height],
  );

  /* --------------------------------- data ---------------------------------- */

  const handleError = useCallback(
    (error: ThreatMapError) => {
      if (onError) {
        onError(error);
        return;
      }
      // No handler: surface it in development, stay silent in production. A
      // library should not spam a production console, nor swallow a bug during
      // development.
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[react-threat-map] ${error.message}`, error.cause ?? '');
      }
    },
    [onError],
  );

  // State geometry is needed to *draw* state borders, and to reverse-resolve
  // bare coordinates to a state. Region codes like 'US-CA' resolve from the
  // inline table and need none of it — so we only pay for the chunk when it
  // would actually change what is rendered.
  const needsStates = regions.showStates || wantsStateResolution(props, attacks);
  const { geo, index } = useGeoData(geoProp, needsStates, handleError);

  const aggregationConfig = props.aggregation;
  const threats = useMemo(
    () =>
      aggregateAttacks(attacks, {
        config: aggregationConfig,
        index,
        onError: (message, attack) => handleError({ kind: 'resolve', message, attack }),
      }),
    [attacks, aggregationConfig, index, handleError],
  );

  // Total attack weight per region, for `renderRegion` choropleths. Skipped
  // entirely unless a hook is actually there to consume it.
  const weights = useMemo(() => {
    if (!renderRegion) return undefined;
    const map = new Map<string, number>();
    for (const threat of threats) {
      map.set(threat.fromRegion.id, (map.get(threat.fromRegion.id) ?? 0) + threat.totalWeight);
    }
    return map;
  }, [threats, renderRegion]);

  const handleRenderError = useCallback(
    (message: string, cause: unknown) => handleError({ kind: 'render', message, cause }),
    [handleError],
  );

  /* -------------------------------- render --------------------------------- */

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        ...(widthProp !== undefined ? { width: widthProp } : { width: '100%' }),
        // With no explicit height, give the box an aspect ratio rather than a
        // pixel height. The canvases are absolutely positioned and so contribute
        // no height of their own; without this the wrapper collapses to zero,
        // which gates off the canvases, which keeps it collapsed. `aspect-ratio`
        // is inert the moment anything else determines the height — a CSS class,
        // a flex parent, or the consumer's own `style` below — so it sets a
        // floor without taking the decision away from them.
        ...(heightProp !== undefined ? { height: heightProp } : { aspectRatio: aspectRatioFor(projectionProp) }),
        ...style,
      }}
      role="img"
      aria-label={ariaLabel}
    >
      {width > 0 && height > 0 ? (
        <>
          <BaseMapCanvas
            width={width}
            height={height}
            pixelRatio={pixelRatio}
            projection={projection}
            geo={geo}
            theme={theme}
            regions={regions}
            renderRegion={renderRegion}
            weights={weights}
            onError={handleRenderError}
          />
          <ThreatCanvas<TMeta>
            width={width}
            height={height}
            pixelRatio={pixelRatio}
            projection={projection}
            threats={threats}
            theme={theme}
            line={line}
            animation={animation}
            renderThreat={renderThreat}
            onThreatClick={onThreatClick}
            onThreatHover={onThreatHover}
            onError={handleRenderError}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Whether any attack needs boundary geometry to resolve to a US state.
 *
 * Only bare `{lat, lng}` origins require it: a region code, or coordinates with
 * an explicit `region`, resolve from the inline table. Loading a ~110 kB chunk
 * for a feed that never needs it would be a waste, so we check rather than
 * assume.
 *
 * The scan stops at the first bare coordinate, so it is O(1) for the common case
 * of a feed that uses region codes throughout.
 */
function wantsStateResolution<TMeta>(props: ThreatMapProps<TMeta>, attacks: readonly Attack<TMeta>[]): boolean {
  const aggregation = props.aggregation;
  if (aggregation === false || aggregation?.enabled === false) return false;
  if (aggregation?.granularity === 'country') return false;

  for (const attack of attacks) {
    if (isBareCoordinate(attack.from) || isBareCoordinate(attack.to)) return true;
  }
  return false;
}

function isBareCoordinate(location: Attack['from']): boolean {
  return typeof location !== 'string' && !('region' in location && location.region);
}

/**
 * A `Threat` re-export at value position would be dropped by `isolatedModules`;
 * this keeps the type reachable from the component module for consumers who
 * import it alongside.
 */
export type { Threat };
