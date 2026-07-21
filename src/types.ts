/**
 * Public data types for `react-threat-map`.
 *
 * Everything a consumer touches is declared here: the attack input shape, the
 * region/location model, theme and configuration objects, and the render hooks.
 *
 * @packageDocumentation
 */

// Imported explicitly rather than reached through the `React` UMD global. The
// global resolves against whatever `@types/react` the consumer happens to have,
// which made the emitted .d.ts depend on an ambient shape we do not control —
// and `@types/react@19` dropped the global `JSX` namespace entirely. These named
// type exports are identical across @types/react 16 through 19.
import type { CSSProperties } from 'react';

/* -------------------------------------------------------------------------- */
/*                                  Geography                                  */
/* -------------------------------------------------------------------------- */

/**
 * A raw geographic coordinate in degrees (WGS84).
 *
 * @example
 * ```ts
 * const paris: LatLng = { lat: 48.8566, lng: 2.3522 };
 * ```
 */
export interface LatLng {
  /** Latitude in degrees, -90 (south pole) to 90 (north pole). */
  readonly lat: number;
  /** Longitude in degrees, -180 (west) to 180 (east). */
  readonly lng: number;
}

/**
 * A string identifier for a region the library can resolve to a coordinate.
 *
 * Accepted forms, matched case-insensitively:
 *
 * - ISO 3166-1 alpha-2 country code — `"FR"`, `"US"`, `"CN"`
 * - ISO 3166-1 alpha-3 country code — `"FRA"`, `"USA"`, `"CHN"`
 * - ISO 3166-2 US state code — `"US-CA"`, `"US-TX"`
 * - Bare USPS state code — `"CA"`, `"TX"` (see the ambiguity note below)
 *
 * Note on bare two-letter codes: a handful collide between country and US state
 * codes (`"CA"` is both Canada and California; also `"AL"`, `"CO"`, `"DE"`,
 * `"GA"`, `"IN"`, `"LA"`, `"MD"`, `"MO"`, `"MS"`, `"MT"`, `"NE"`, `"PA"`, `"SC"`,
 * `"SD"`, `"VA"`). Bare codes always resolve to the **country** — `"CA"` is
 * Canada. Use the unambiguous `"US-CA"` form for states. Resolution never
 * guesses; an unresolvable identifier is reported through `onError` rather than
 * silently dropped.
 *
 * The type is `string` rather than a literal union on purpose: a closed union of
 * ~300 codes produces unreadable IDE errors and breaks consumers whose data is
 * typed as `string` from an API. Validation happens at resolution time, where a
 * useful error message is possible.
 */
export type RegionCode = string;

/**
 * Where an attack starts or ends.
 *
 * Three interchangeable forms, so you can pass whatever your data already has:
 *
 * 1. A {@link RegionCode} string — `"FR"`, `"US-CA"`. Resolved to that region's
 *    anchor coordinate. Cheapest option: no geometry needed, and aggregation
 *    knows the region without a reverse lookup.
 * 2. A {@link LatLng} — exact coordinates. Aggregation reverse-resolves the
 *    region via point-in-polygon once the geo data has loaded.
 * 3. A {@link LatLng} **with** a `region` — exact coordinates *and* an explicit
 *    aggregation key. Best of both: pixel-accurate placement, zero-cost grouping.
 *    Use this when your feed already carries geo-IP region data.
 *
 * @example
 * ```ts
 * const a: AttackLocation = 'US-CA';
 * const b: AttackLocation = { lat: 34.05, lng: -118.24 };
 * const c: AttackLocation = { lat: 34.05, lng: -118.24, region: 'US-CA' };
 * ```
 */
export type AttackLocation = RegionCode | LatLng | (LatLng & { readonly region?: RegionCode });

/**
 * How specific a resolved region is.
 *
 * - `'country'` — resolved to a country (e.g. France).
 * - `'state'` — resolved to a US state (e.g. California).
 * - `'unknown'` — coordinates that fall outside all known boundaries (ocean,
 *   Antarctica, disputed areas), or a region code that could not be resolved.
 */
export type RegionKind = 'country' | 'state' | 'unknown';

/**
 * A region resolved from an {@link AttackLocation}, as produced by the geo layer
 * and handed to aggregation key functions and render hooks.
 */
export interface ResolvedRegion {
  /**
   * Canonical, stable identifier. Countries use ISO alpha-2 (`"FR"`); US states
   * use ISO 3166-2 (`"US-CA"`). Unknown regions use `"??"`.
   *
   * This — not the display name — is what aggregation groups on.
   */
  readonly id: string;
  /** Human-readable name, e.g. `"France"` or `"California"`. */
  readonly name: string;
  /** Granularity of this resolution. */
  readonly kind: RegionKind;
  /** ISO alpha-2 of the containing country. For `"US-CA"` this is `"US"`. */
  readonly countryCode: string;
}

/* -------------------------------------------------------------------------- */
/*                                   Attacks                                  */
/* -------------------------------------------------------------------------- */

/**
 * Severity of an attack. Drives the threat's color via {@link ThreatMapTheme.severityColors}
 * and its baseline visual weight.
 *
 * Custom severity strings are permitted — supply a matching entry in
 * `theme.severityColors` and it will be used. Unrecognized values fall back to
 * `theme.severityColors.medium`.
 */
export type Severity = 'low' | 'medium' | 'high' | 'critical' | (string & {});

/**
 * A single cyberattack: the library's input unit.
 *
 * Only `from` and `to` are required. Everything else is metadata that
 * influences styling, grouping, or your own render hooks.
 *
 * @example Minimal
 * ```ts
 * const attacks: Attack[] = [{ from: 'CN', to: 'US-CA' }];
 * ```
 *
 * @example Realistic feed row
 * ```ts
 * const attack: Attack = {
 *   id: 'evt-84321',
 *   from: { lat: 39.9, lng: 116.4, region: 'CN' },
 *   to: 'US-CA',
 *   timestamp: Date.now(),
 *   type: 'ssh-bruteforce',
 *   severity: 'high',
 *   meta: { targetPort: 22, attempts: 1_204 },
 * };
 * ```
 */
export interface Attack<TMeta = unknown> {
  /**
   * Stable unique identifier.
   *
   * Strongly recommended for streaming feeds: it is how the renderer keeps an
   * in-flight animation attached to the right attack across re-renders. Without
   * one, a fallback key is derived from `from`/`to`/`timestamp`, and attacks
   * that collide on all three are treated as the same threat.
   */
  readonly id?: string;
  /** Where the attack originates. */
  readonly from: AttackLocation;
  /** Where the attack is directed. */
  readonly to: AttackLocation;
  /** Epoch milliseconds. Used for time-window filtering and as a fallback key input. */
  readonly timestamp?: number;
  /** Free-form classification, e.g. `"ddos"`, `"phishing"`. Available to hooks; not interpreted by the library. */
  readonly type?: string;
  /** Severity band. Defaults to `'medium'` when omitted. */
  readonly severity?: Severity;
  /**
   * Relative importance, default `1`. Aggregation sums weights rather than
   * counting rows, so one row representing 500 blocked packets can carry
   * `weight: 500` and size the line accordingly.
   */
  readonly weight?: number;
  /** Your own payload. Passed through untouched to hooks and event handlers. */
  readonly meta?: TMeta;
}

/* -------------------------------------------------------------------------- */
/*                                   Threats                                  */
/* -------------------------------------------------------------------------- */

/**
 * A renderable line, produced by the aggregation stage from one or more
 * {@link Attack}s. This is what actually gets drawn, and what render hooks and
 * event handlers receive.
 *
 * When aggregation is disabled, exactly one threat is produced per attack, with
 * `count === 1` and `attacks.length === 1`.
 */
export interface Threat<TMeta = unknown> {
  /** Stable identity across frames — the aggregation group key, or the attack id when ungrouped. */
  readonly id: string;
  /** Resolved origin coordinate, in degrees. */
  readonly from: LatLng;
  /** Resolved destination coordinate, in degrees. */
  readonly to: LatLng;
  /** Origin region. `kind: 'unknown'` if it could not be resolved. */
  readonly fromRegion: ResolvedRegion;
  /** Destination region. */
  readonly toRegion: ResolvedRegion;
  /** Number of underlying attacks. `1` when unaggregated. */
  readonly count: number;
  /** Sum of the underlying attacks' `weight` values (each defaulting to `1`). */
  readonly totalWeight: number;
  /** Effective severity. By default the **max** severity across members — see {@link AggregationConfig.severity}. */
  readonly severity: Severity;
  /**
   * Visual weight multiplier derived from `count` via {@link AggregationConfig.scale}.
   * `1` means baseline thickness; `2` means twice as heavy. Applied to line
   * width, glow radius, and head size.
   */
  readonly intensity: number;
  /** The attacks that were folded into this threat. Always at least one. */
  readonly attacks: readonly Attack<TMeta>[];
}

/* -------------------------------------------------------------------------- */
/*                                 Aggregation                                */
/* -------------------------------------------------------------------------- */

/**
 * How finely origins are grouped.
 *
 * - `'auto'` *(default)* — US origins group by **state**, everything else by
 *   **country**. This is what makes California and Texas distinct aggregates
 *   while keeping the rest of the world at country level.
 * - `'state'` — always prefer state granularity where known (currently US only);
 *   elsewhere behaves like `'country'`.
 * - `'country'` — always country level. California and Texas both become `"US"`.
 */
export type AggregationGranularity = 'auto' | 'state' | 'country';

/**
 * What constitutes "the same threat".
 *
 * - `'origin-destination'` *(default)* — one line per origin→destination region
 *   pair. France→US and France→Japan stay separate, because they are visually
 *   distinct lines and collapsing them has no meaningful endpoint.
 * - `'origin'` — one line per origin region, regardless of destination. The
 *   destination becomes the origin's most frequent target region. Use when you
 *   want strictly one line per attacking region.
 */
export type AggregationGroupBy = 'origin-destination' | 'origin';

/**
 * Maps an aggregate's attack count to a visual weight multiplier.
 *
 * @param count - Number of attacks in the group (>= 1).
 * @param totalWeight - Sum of member `weight` values.
 * @returns Multiplier applied to line width/glow/head size. `1` is baseline.
 */
export type IntensityScale = (count: number, totalWeight: number) => number;

/**
 * Derives a grouping key for an attack. Attacks yielding the same key merge into
 * one threat.
 *
 * @param attack - The original attack.
 * @param from - Its resolved origin region.
 * @param to - Its resolved destination region.
 * @returns A group key, or `null` to exclude this attack from aggregation and
 *          render it on its own.
 *
 * @example Group by origin country and attack type together
 * ```ts
 * const key: AggregationKeyFn = (attack, from) => `${from.id}:${attack.type ?? 'unknown'}`;
 * ```
 */
export type AggregationKeyFn<TMeta = unknown> = (
  attack: Attack<TMeta>,
  from: ResolvedRegion,
  to: ResolvedRegion,
) => string | null;

/**
 * Picks the severity for an aggregate from its members' severities.
 *
 * @param severities - Every member's severity, in input order. Never empty.
 * @returns The severity the aggregated threat should render as.
 */
export type AggregationSeverityFn = (severities: readonly Severity[]) => Severity;

/**
 * Controls how attacks sharing an origin collapse into single, heavier threats.
 *
 * Pass `aggregation={false}` on {@link ThreatMapProps} to disable entirely and
 * render one line per attack.
 *
 * @example Group at country level only, and require 3 attacks before merging
 * ```tsx
 * <ThreatMap
 *   attacks={attacks}
 *   aggregation={{ granularity: 'country', minCount: 3 }}
 * />
 * ```
 */
export interface AggregationConfig<TMeta = unknown> {
  /** Master switch. Default `true`. Equivalent to passing `aggregation={false}`. */
  readonly enabled?: boolean;
  /** Origin granularity. Default `'auto'` (US → state, elsewhere → country). */
  readonly granularity?: AggregationGranularity;
  /** What counts as the same threat. Default `'origin-destination'`. */
  readonly groupBy?: AggregationGroupBy;
  /**
   * Full override of the grouping key. When provided, `granularity` and
   * `groupBy` are ignored. Returning `null` renders that attack individually.
   */
  readonly key?: AggregationKeyFn<TMeta>;
  /**
   * Minimum group size to merge. Groups smaller than this are emitted as
   * individual threats instead. Default `2` — a "group" of one is just an attack.
   */
  readonly minCount?: number;
  /**
   * Cap on rendered threats, keeping the heaviest groups by `totalWeight`.
   * Unlimited by default. A backstop for feeds that can spike unboundedly.
   */
  readonly maxGroups?: number;
  /**
   * count → visual weight multiplier. Default is a logarithmic ramp
   * (`1 + log2(count) * 0.5`), clamped to `[1, 6]`: it keeps a 500-attack group
   * visibly heavier than a 5-attack one without rendering a line 500× thick.
   */
  readonly scale?: IntensityScale;
  /** How an aggregate picks its severity. Default: the **max** severity among members. */
  readonly severity?: AggregationSeverityFn;
}

/* -------------------------------------------------------------------------- */
/*                                    Theme                                   */
/* -------------------------------------------------------------------------- */

/**
 * Any CSS color string the Canvas 2D context accepts — `"#0af"`,
 * `"rgb(0 170 255)"`, `"hsl(200 100% 50% / 0.5)"`, `"tomato"`.
 */
export type Color = string;

/**
 * Colors for the map and the threats drawn over it.
 *
 * Every field is optional in {@link ThreatMapProps.theme}: what you pass is
 * merged over {@link defaultTheme}, so you can restyle one color without
 * restating the rest.
 *
 * @example Light theme
 * ```tsx
 * <ThreatMap attacks={attacks} theme={{ ocean: '#eef2f6', land: '#d6dee8', border: '#fff' }} />
 * ```
 */
export interface ThreatMapTheme {
  /** Background behind the landmasses. */
  readonly ocean: Color;
  /** Country/state fill. */
  readonly land: Color;
  /** Country border stroke. */
  readonly border: Color;
  /** Country border width in CSS pixels. */
  readonly borderWidth: number;
  /** US state border stroke, when `regions.showStates` is on. */
  readonly stateBorder: Color;
  /** US state border width in CSS pixels. */
  readonly stateBorderWidth: number;
  /**
   * Threat line color per severity. Extra keys are allowed for custom severity
   * strings; a severity with no entry falls back to `medium`.
   */
  readonly severityColors: Readonly<Record<string, Color>>;
  /** Color of the dot travelling along the path. Defaults to the threat's severity color when `null`. */
  readonly headColor: Color | null;
  /** Origin marker color. Applies when `line.showOrigin` is on. */
  readonly originColor: Color;
  /** Impact ripple color at the destination. Applies when `line.showImpact` is on. */
  readonly impactColor: Color;
}

/* -------------------------------------------------------------------------- */
/*                              Lines & animation                             */
/* -------------------------------------------------------------------------- */

/** Geometry and styling of the threat arcs. */
export interface LineStyleConfig {
  /**
   * Arc height as a fraction of the chord length. `0` draws a straight geodesic;
   * `0.3` bows noticeably. Default `0.22`. Negative values arc the other way.
   */
  readonly curvature: number;
  /** Baseline stroke width in CSS pixels, before `intensity` scaling. Default `1.2`. */
  readonly width: number;
  /** Opacity of the full arc that sits behind the animated head, `0`–`1`. Default `0.28`. */
  readonly trackOpacity: number;
  /** Opacity of the lit trail behind the head, `0`–`1`. Default `0.95`. */
  readonly trailOpacity: number;
  /** Trail length as a fraction of the path, `0`–`1`. Default `0.18`. */
  readonly trailLength: number;
  /** Glow strength, `0` (off) to `1`. Rendered as a cheap wide/narrow double-stroke. Default `0.5`. */
  readonly glow: number;
  /** Radius of the travelling head dot in CSS pixels, before `intensity` scaling. Default `2`. */
  readonly headRadius: number;
  /** Draw a static marker at each origin. Default `true`. */
  readonly showOrigin: boolean;
  /** Draw an expanding ripple where a head lands. Default `true`. */
  readonly showImpact: boolean;
  /**
   * Number of straight segments each arc is flattened into. Higher is smoother
   * and costlier to precompute (not to draw). Default `48`.
   */
  readonly segments: number;
}

/** Named easing curves for the head's travel along the path. */
export type EasingName = 'linear' | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad' | 'easeInOutCubic';

/** Controls the animation loop. */
export interface AnimationConfig {
  /**
   * Master switch. Default `true`. When `false` no `requestAnimationFrame` loop
   * runs at all — arcs render statically and the component costs nothing per
   * frame. Also respects `prefers-reduced-motion` unless
   * {@link AnimationConfig.respectReducedMotion} is `false`.
   */
  readonly enabled: boolean;
  /** Full path traversals per second. Default `0.5` (one trip every 2s). */
  readonly speed: number;
  /** Easing for head position. Name or your own `(t: 0..1) => 0..1`. Default `'easeInOutQuad'`. */
  readonly easing: EasingName | ((t: number) => number);
  /**
   * Randomized phase offset spread, `0`–`1`. At `0` every threat launches in
   * lockstep; at `1` phases are fully scattered. Default `1`.
   */
  readonly stagger: number;
  /** Restart on completion. Default `true`. When `false` each threat animates once and holds. */
  readonly loop: boolean;
  /** Fade-in duration in ms for newly appearing threats. Default `400`. */
  readonly fadeIn: number;
  /** Fade-out duration in ms when a threat leaves `attacks`. Default `600`. */
  readonly fadeOut: number;
  /** Honor the `prefers-reduced-motion` media query. Default `true`. */
  readonly respectReducedMotion: boolean;
}

/* -------------------------------------------------------------------------- */
/*                            Projection & regions                            */
/* -------------------------------------------------------------------------- */

/**
 * Map projection.
 *
 * - `'naturalEarth1'` *(default)* — compromise projection; the usual choice for
 *   world maps. Balanced distortion, pleasant shape.
 * - `'equirectangular'` — plate carrée. Lat/lng map linearly to x/y.
 * - `'mercator'` — familiar from web maps; badly inflates high latitudes.
 * - `'orthographic'` — globe view. Half the world is not visible.
 *
 * You may also pass any [d3-geo](https://github.com/d3/d3-geo) projection
 * instance for full control; the library will fit it to the viewport.
 */
export type ProjectionName = 'naturalEarth1' | 'equirectangular' | 'mercator' | 'orthographic';

/** A projection name, or a d3-geo projection object. */
export type ProjectionSpec = ProjectionName | GeoProjectionLike;

/**
 * The slice of d3-geo's `GeoProjection` this library depends on. Structural, so
 * any d3-geo projection satisfies it without importing d3's types.
 */
export interface GeoProjectionLike {
  /** Project `[lng, lat]` degrees to `[x, y]` pixels, or `null` if unprojectable. */
  (point: [number, number]): [number, number] | null;
  /** Inverse-project pixels back to `[lng, lat]`. Optional — not all projections have one. */
  invert?: (point: [number, number]) => [number, number] | null;
  /** Scale the projection to fit `extent` around `object`. */
  fitExtent?: (extent: [[number, number], [number, number]], object: unknown) => GeoProjectionLike;
  /** Get/set the projection scale. */
  scale?: { (): number; (scale: number): GeoProjectionLike };
  /** Get/set the projection translation. */
  translate?: { (): [number, number]; (translate: [number, number]): GeoProjectionLike };
  /** Get/set the projection rotation. */
  rotate?: { (): number[]; (angles: number[]): GeoProjectionLike };
}

/** Which boundaries to draw. */
export interface RegionsConfig {
  /** Draw country boundaries. Default `true`. */
  readonly showCountries: boolean;
  /**
   * Draw US state boundaries. Default `false` — it costs a separate ~40 kB
   * lazy chunk. Turn on when US-state-level origins matter visually.
   *
   * Independent of aggregation: `granularity: 'auto'` groups by state whether or
   * not state borders are drawn.
   */
  readonly showStates: boolean;
  /** Draw the graticule (lat/lng grid). Default `false`. */
  readonly showGraticule: boolean;
  /** Graticule stroke color. Default a low-alpha white. */
  readonly graticuleColor: Color;
  /** Draw the sphere outline around the projected globe. Default `true`. */
  readonly showSphere: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                Render hooks                                */
/* -------------------------------------------------------------------------- */

/**
 * Everything a custom threat renderer needs, handed to it per threat per frame.
 */
export interface ThreatRenderContext<TMeta = unknown> {
  /** The threat being drawn, including its `count` and `intensity`. */
  readonly threat: Threat<TMeta>;
  /**
   * The precomputed arc in screen pixels, flattened to `line.segments + 1`
   * points as a flat `[x0, y0, x1, y1, ...]` array. Already projected, arced,
   * and split at the antimeridian.
   */
  readonly points: Float32Array;
  /** Animation progress of the head along the path, `0`–`1`, easing already applied. */
  readonly progress: number;
  /** Overall opacity `0`–`1`, accounting for fade-in/fade-out. Multiply your alpha by this. */
  readonly alpha: number;
  /** Resolved theme, with defaults filled in. */
  readonly theme: ThreatMapTheme;
  /** Resolved line config, with defaults filled in. */
  readonly line: LineStyleConfig;
  /** Device pixel ratio the canvas is scaled to. The context is already transformed; you rarely need this. */
  readonly pixelRatio: number;
  /** Milliseconds since the animation loop started. Useful for your own time-based effects. */
  readonly elapsed: number;
}

/**
 * Draws a single threat, replacing the built-in renderer for it.
 *
 * The context is pre-transformed for device pixel ratio, so draw in CSS pixels.
 * Save/restore is handled around your call; you may mutate context state freely.
 *
 * Returning `false` falls through to the built-in renderer for that threat —
 * useful for customizing only some threats.
 *
 * Note: opting into this hook opts that threat out of style batching, so it
 * costs a draw call of its own. Fine for tens of threats; if you need custom
 * drawing on hundreds, prefer restyling via `theme`/`line`.
 *
 * @example Label the heaviest aggregates
 * ```tsx
 * const renderThreat: ThreatRenderer = (ctx, { threat, points, alpha }) => {
 *   if (threat.count < 50) return false; // built-in renderer handles the rest
 *   ctx.globalAlpha = alpha;
 *   ctx.fillStyle = '#fff';
 *   ctx.fillText(`${threat.count}`, points[0], points[1] - 6);
 *   return false; // still draw the normal line underneath
 * };
 * ```
 */
export type ThreatRenderer<TMeta = unknown> = (
  ctx: CanvasRenderingContext2D,
  info: ThreatRenderContext<TMeta>,
) => void | boolean;

/** Everything a custom region renderer needs. */
export interface RegionRenderContext {
  /** The region's GeoJSON feature. */
  readonly feature: GeoFeature;
  /** Canonical region id — `"FR"`, `"US-CA"`. */
  readonly id: string;
  /** Granularity of this feature. */
  readonly kind: Exclude<RegionKind, 'unknown'>;
  /**
   * A d3-geo path generator already bound to this canvas context and the active
   * projection. Call `path(feature)` to lay down the outline, then fill/stroke.
   */
  readonly path: (feature: GeoFeature) => void;
  /** Resolved theme. */
  readonly theme: ThreatMapTheme;
  /** Total attack weight originating in this region this frame — handy for choropleths. */
  readonly weight: number;
}

/**
 * Draws a single map region, replacing the built-in fill/stroke for it.
 *
 * Runs only when the base map is (re)rasterized — on mount, resize, and
 * theme/projection change — not per animation frame.
 *
 * Returning `false` falls through to the built-in renderer.
 *
 * @example Heat-shade countries by attack volume
 * ```tsx
 * const renderRegion: RegionRenderer = (ctx, { feature, path, weight, theme }) => {
 *   ctx.beginPath();
 *   path(feature);
 *   ctx.fillStyle = weight > 0 ? `hsl(0 80% ${20 + Math.min(weight, 40)}%)` : theme.land;
 *   ctx.fill();
 *   return true; // we handled it
 * };
 * ```
 */
export type RegionRenderer = (ctx: CanvasRenderingContext2D, info: RegionRenderContext) => void | boolean;

/* -------------------------------------------------------------------------- */
/*                                  Geo data                                  */
/* -------------------------------------------------------------------------- */

/** A minimal GeoJSON geometry, narrowed to what this library draws. */
export type GeoGeometry =
  | { readonly type: 'Polygon'; readonly coordinates: number[][][] }
  | { readonly type: 'MultiPolygon'; readonly coordinates: number[][][][] };

/** A GeoJSON feature for one country or US state. */
export interface GeoFeature {
  readonly type: 'Feature';
  /** Canonical region id — ISO alpha-2 for countries, ISO 3166-2 for states. */
  readonly id: string;
  readonly properties: {
    /** Display name. */
    readonly name: string;
    /** Granularity. */
    readonly kind: 'country' | 'state';
    /** ISO alpha-2 of the containing country. */
    readonly countryCode: string;
  };
  readonly geometry: GeoGeometry;
}

/** A GeoJSON feature collection of regions. */
export interface GeoFeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: readonly GeoFeature[];
}

/**
 * The boundary geometry the map draws and reverse region lookup tests against.
 *
 * Loaded lazily by default. Pass your own via {@link ThreatMapProps.geo} to
 * self-host, preload, or substitute different boundaries.
 */
export interface GeoData {
  /** Country boundaries. */
  readonly countries: GeoFeatureCollection;
  /** US state boundaries. Omit if you never enable states or state aggregation. */
  readonly states?: GeoFeatureCollection;
}

/* -------------------------------------------------------------------------- */
/*                              Component props                               */
/* -------------------------------------------------------------------------- */

/** An error the library recovered from, surfaced via {@link ThreatMapProps.onError}. */
export interface ThreatMapError {
  /**
   * - `'geo-load'` — the geo data chunk failed to load. The map stays blank; threats with
   *   explicit region codes or coordinates still render.
   * - `'resolve'` — an attack's `from`/`to` could not be resolved to a coordinate. That
   *   attack is skipped.
   * - `'render'` — a `renderThreat`/`renderRegion` hook threw. The hook is disabled for
   *   the rest of the frame and the built-in renderer takes over.
   */
  readonly kind: 'geo-load' | 'resolve' | 'render';
  /** Human-readable description. */
  readonly message: string;
  /** The underlying error, when there was one. */
  readonly cause?: unknown;
  /** The attack involved, for `'resolve'` errors. */
  readonly attack?: Attack<unknown>;
}

/**
 * Props for {@link ThreatMap}.
 *
 * Only `attacks` is required. Every config object is deeply merged over the
 * defaults, so partial overrides are safe and stable.
 */
export interface ThreatMapProps<TMeta = unknown> {
  /**
   * The attacks to display. Treated as the complete current set: attacks that
   * disappear from this array fade out.
   *
   * For streaming feeds, keep this array referentially stable between updates —
   * a new array identity re-runs resolution and aggregation. Resolution is
   * memoized per attack `id`, so appending to a growing array is cheap.
   */
  readonly attacks: readonly Attack<TMeta>[];

  /** Width in CSS pixels. Omit to fill the container width and track it via `ResizeObserver`. */
  readonly width?: number;
  /** Height in CSS pixels. Omit to derive from width and the projection's aspect ratio. */
  readonly height?: number;

  /** Projection name or a d3-geo projection instance. Default `'naturalEarth1'`. */
  readonly projection?: ProjectionSpec;
  /** Color overrides, merged over {@link defaultTheme}. */
  readonly theme?: Partial<ThreatMapTheme>;
  /** Arc geometry/styling overrides, merged over {@link defaultLineStyle}. */
  readonly line?: Partial<LineStyleConfig>;
  /** Animation overrides, merged over {@link defaultAnimation}. */
  readonly animation?: Partial<AnimationConfig>;
  /** Boundary-drawing overrides, merged over {@link defaultRegions}. */
  readonly regions?: Partial<RegionsConfig>;
  /**
   * Aggregation overrides, merged over {@link defaultAggregation}. Pass `false`
   * to render one line per attack.
   */
  readonly aggregation?: Partial<AggregationConfig<TMeta>> | false;

  /** Override how a threat is drawn. See {@link ThreatRenderer}. */
  readonly renderThreat?: ThreatRenderer<TMeta>;
  /** Override how a region is drawn. See {@link RegionRenderer}. */
  readonly renderRegion?: RegionRenderer;

  /**
   * Supply geo data instead of lazy-loading it. Accepts the data directly or a
   * loader function. Use to self-host the JSON, preload during app boot, or swap
   * in different boundaries.
   */
  readonly geo?: GeoData | (() => Promise<GeoData>);

  /** Called when a threat is clicked. Hit testing uses the arc, within a few pixels. */
  readonly onThreatClick?: (threat: Threat<TMeta>, event: MouseEvent) => void;
  /** Called when the pointer enters/leaves a threat. `null` on leave. */
  readonly onThreatHover?: (threat: Threat<TMeta> | null, event: MouseEvent) => void;
  /** Called for recoverable errors. Without a handler these are logged in dev and swallowed in prod. */
  readonly onError?: (error: ThreatMapError) => void;

  /** Applied to the wrapper element. */
  readonly className?: string;
  /** Applied to the wrapper element. The canvases fill it. */
  readonly style?: CSSProperties;
  /** Accessible label for the map. Default `"Cyberattack threat map"`. */
  readonly ariaLabel?: string;
}
