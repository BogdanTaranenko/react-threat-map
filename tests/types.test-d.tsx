/**
 * Type-contract tests.
 *
 * These assert the *shape* of the public API — that documented usage compiles
 * and that misuse does not. They are checked by `tsc --noEmit` (via
 * `npm run typecheck`), which is the only thing that can verify a type claim;
 * a runtime test cannot. `expectError` cases are asserted with `@ts-expect-error`,
 * which fails the build if the line ever stops being an error.
 *
 * @packageDocumentation
 */

import {
  ThreatMap,
  aggregateAttacks,
  defaultTheme,
  defaultAggregation,
  defaultIntensityScale,
  lookupRegionCode,
  resolveLocation,
  type AggregationConfig,
  type AggregationKeyFn,
  type Attack,
  type AttackLocation,
  type GeoData,
  type LatLng,
  type ProjectionSpec,
  type RegionRenderer,
  type ResolvedRegion,
  type Severity,
  type Threat,
  type ThreatMapProps,
  type ThreatMapTheme,
  type ThreatRenderer,
} from '../src/index.js';

/**
 * Asserts that `value` is assignable to `T`. The call is what keeps the binding
 * "used", so `noUnusedLocals` does not mask a real contract failure.
 */
function expectType<T>(_value: T): void {}

/* ------------------------- Attack accepts every documented location shape ---- */

const _locations: AttackLocation[] = [
  'FR',
  'FRA',
  'US-CA',
  { lat: 34.05, lng: -118.24 },
  { lat: 34.05, lng: -118.24, region: 'US-CA' },
];

const _minimal: Attack = { from: 'CN', to: 'US-CA' };

const _full: Attack = {
  id: 'evt-1',
  from: { lat: 39.9, lng: 116.4, region: 'CN' },
  to: 'US-CA',
  timestamp: Date.now(),
  type: 'ssh-bruteforce',
  severity: 'high',
  weight: 1204,
  meta: { targetPort: 22 },
};

// A custom severity string is allowed alongside the known union.
const _customSeverity: Attack = { from: 'FR', to: 'JP', severity: 'apocalyptic' };
const _knownSeverity: Severity = 'critical';

// @ts-expect-error — `from` is required.
const _missingFrom: Attack = { to: 'FR' };

// @ts-expect-error — a bare number is not a location.
const _badLocation: Attack = { from: 42, to: 'FR' };

// @ts-expect-error — lat/lng must be numbers.
const _badCoords: Attack = { from: { lat: '34', lng: '-118' }, to: 'FR' };

/* --------------------------- Attack meta is generic and inferred ------------- */

interface FeedMeta {
  readonly sourceIp: string;
  readonly blocked: boolean;
}

const _typedAttacks: Attack<FeedMeta>[] = [
  { from: 'CN', to: 'US-CA', meta: { sourceIp: '10.0.0.1', blocked: true } },
];

// @ts-expect-error — meta must match the parameter.
const _wrongMeta: Attack<FeedMeta> = { from: 'CN', to: 'US', meta: { nope: 1 } };

const _typedThreats: Threat<FeedMeta>[] = aggregateAttacks(_typedAttacks);
// meta flows through aggregation to the threat's attacks.
const _ip: string | undefined = _typedThreats[0]?.attacks[0]?.meta?.sourceIp;
// @ts-expect-error — the meta type is preserved, so unknown fields are rejected.
const _noSuchField = _typedThreats[0]?.attacks[0]?.meta?.nope;

/* ------------------------------- Attack is readonly -------------------------- */

const _frozen: Attack = { from: 'FR', to: 'JP' };
// @ts-expect-error — Attack fields are readonly; consumers should not mutate input.
_frozen.from = 'US';

const _threat: Threat = aggregateAttacks([_frozen])[0]!;
// @ts-expect-error — Threat is readonly output.
_threat.count = 99;

/* --------------------------------- component --------------------------------- */

const _simplest = <ThreatMap attacks={[{ from: 'CN', to: 'US-CA' }]} />;

const _configured = (
  <ThreatMap
    attacks={_typedAttacks}
    width={800}
    height={400}
    projection="naturalEarth1"
    theme={{ ocean: '#000' }}
    line={{ curvature: 0.4, width: 2 }}
    animation={{ speed: 1.5, easing: 'easeInOutCubic' }}
    regions={{ showStates: true }}
    aggregation={{ granularity: 'state', minCount: 3 }}
    onThreatClick={(threat) => {
      // The generic flows into the handler.
      expectType<boolean | undefined>(threat.attacks[0]?.meta?.blocked);
    }}
  />
);

// Aggregation can be disabled with a literal false.
const _noAggregation = <ThreatMap attacks={[{ from: 'CN', to: 'US' }]} aggregation={false} />;

// @ts-expect-error — attacks is required.
const _noAttacks = <ThreatMap />;

// @ts-expect-error — unknown projection name.
const _badProjection = <ThreatMap attacks={[]} projection="mollweide" />;

// @ts-expect-error — unknown theme key.
const _badThemeKey = <ThreatMap attacks={[]} theme={{ oceanColour: '#000' }} />;

// @ts-expect-error — granularity must be one of the documented values.
const _badGranularity = <ThreatMap attacks={[]} aggregation={{ granularity: 'city' }} />;

// @ts-expect-error — `true` is not a valid aggregation value; omit it instead.
const _badAggregation = <ThreatMap attacks={[]} aggregation />;

/* ------------------------------ partial configs ------------------------------ */

// Every config object must accept a partial override.
const _partialTheme: ThreatMapProps['theme'] = { ocean: '#111' };
const _partialLine: ThreatMapProps['line'] = { curvature: 0.1 };
const _partialAnimation: ThreatMapProps['animation'] = { enabled: false };
const _partialRegions: ThreatMapProps['regions'] = { showStates: true };

// Defaults are fully-resolved objects.
const _fullTheme: ThreatMapTheme = defaultTheme;
const _oceanColor: string = defaultTheme.ocean;
const _lowColor: string | undefined = defaultTheme.severityColors.low;

// @ts-expect-error — defaults are frozen at the type level.
defaultTheme.ocean = '#fff';

/* ------------------------------- aggregation --------------------------------- */

const _key: AggregationKeyFn = (attack, from, to) => `${from.id}>${to.id}:${attack.type}`;
const _keyOptOut: AggregationKeyFn = () => null;

const _aggConfig: AggregationConfig = {
  enabled: true,
  granularity: 'auto',
  groupBy: 'origin-destination',
  key: _key,
  minCount: 2,
  maxGroups: 100,
  scale: (count, totalWeight) => 1 + Math.log2(count) * (totalWeight > 100 ? 0.8 : 0.5),
  severity: (severities) => severities[0] ?? 'medium',
};

const _scaleFromDefaults: number = defaultIntensityScale(10, 10);
const _defaultsAreReadable: number = defaultAggregation.minCount;

// The key function receives fully resolved regions.
const _regionFields: AggregationKeyFn = (_attack, from) => {
  expectType<string>(from.id);
  expectType<string>(from.name);
  expectType<'country' | 'state' | 'unknown'>(from.kind);
  expectType<string>(from.countryCode);
  return from.id;
};

// @ts-expect-error — scale must return a number.
const _badScale: AggregationConfig = { scale: () => 'thick' };

/* --------------------------------- render hooks ------------------------------ */

const _renderThreat: ThreatRenderer = (ctx, { threat, points, progress, alpha, theme, line }) => {
  expectType<number>(points[0]!);
  expectType<number>(threat.count);
  expectType<number>(threat.intensity);
  ctx.globalAlpha = alpha * progress;
  ctx.strokeStyle = theme.severityColors[threat.severity] ?? theme.land;
  ctx.lineWidth = line.width;
  return false; // fall through to the built-in renderer
};

const _renderRegion: RegionRenderer = (ctx, { feature, id, kind, path, theme, weight }) => {
  expectType<string>(id);
  expectType<'country' | 'state'>(kind);
  expectType<number>(weight);
  ctx.beginPath();
  path(feature);
  ctx.fillStyle = weight > 0 ? '#f00' : theme.land;
  ctx.fill();
  return true; // handled
};

/* ----------------------------------- geo ------------------------------------- */

const _point: LatLng = { lat: 1, lng: 2 };
const _entry = lookupRegionCode('US-CA');
const _anchor: LatLng | undefined = _entry?.anchor;
const _resolvedName: string | undefined = _entry?.name;

const _result = resolveLocation('US-CA');
if (_result.ok) {
  expectType<ResolvedRegion>(_result.value.region);
  expectType<LatLng>(_result.value.point);
} else {
  expectType<string>(_result.reason);
}

// The geo prop accepts data or a loader.
const _geoData: ThreatMapProps['geo'] = { countries: { type: 'FeatureCollection', features: [] } } as GeoData;
const _geoLoader: ThreatMapProps['geo'] = async () => ({ countries: { type: 'FeatureCollection', features: [] } });

/* -------------------------------- projections -------------------------------- */

const _names: ProjectionSpec[] = ['naturalEarth1', 'equirectangular', 'mercator', 'orthographic'];

// A structural d3-geo projection satisfies the spec without importing d3 types.
const _custom: ProjectionSpec = Object.assign((p: [number, number]) => [p[0], p[1]] as [number, number], {
  invert: (p: [number, number]) => [p[0], p[1]] as [number, number],
});

/* Reference every binding so `noUnusedLocals` does not mask a real failure. */
export const __contract = {
  _locations, _minimal, _full, _customSeverity, _knownSeverity, _missingFrom, _badLocation, _badCoords,
  _typedAttacks, _wrongMeta, _typedThreats, _ip, _noSuchField, _frozen, _threat,
  _simplest, _configured, _noAggregation, _noAttacks, _badProjection, _badThemeKey, _badGranularity, _badAggregation,
  _partialTheme, _partialLine, _partialAnimation, _partialRegions, _fullTheme, _oceanColor, _lowColor,
  _key, _keyOptOut, _aggConfig, _scaleFromDefaults, _defaultsAreReadable, _regionFields, _badScale,
  _renderThreat, _renderRegion, _point, _entry, _anchor, _resolvedName, _result,
  _geoData, _geoLoader, _names, _custom,
};
