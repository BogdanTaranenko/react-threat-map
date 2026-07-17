/**
 * react-threat-map — animated cyberattack threats on a static world map, with
 * intelligent per-region aggregation and first-class US state support.
 *
 * ```tsx
 * import { ThreatMap } from 'react-threat-map';
 *
 * <ThreatMap attacks={[{ from: 'CN', to: 'US-CA', severity: 'high' }]} />
 * ```
 *
 * @packageDocumentation
 */

/* -------------------------------- component ------------------------------- */

export { ThreatMap } from './components/ThreatMap.js';

/* --------------------------------- config --------------------------------- */

export { defaultTheme, defaultLineStyle, defaultAnimation, defaultRegions } from './config.js';
export { defaultAggregation } from './aggregation/aggregate.js';

/* ------------------------------- aggregation ------------------------------ */

export { aggregateAttacks } from './aggregation/aggregate.js';
export type { AggregateOptions, ResolvedAggregationConfig } from './aggregation/aggregate.js';
export { defaultIntensityScale, MAX_INTENSITY } from './aggregation/scale.js';
export { maxSeverity, severityRank, regionKey, SEVERITY_ORDER } from './aggregation/keys.js';

/* ----------------------------------- geo ---------------------------------- */

// Region resolution only — this is the small inline table. Boundary geometry
// lives behind the `react-threat-map/geo` entry point so it stays lazy.
export { lookupRegionCode, getRegionById, listRegions, UNKNOWN_REGION } from './geo/regions.js';
export type { RegionEntry } from './geo/regions.js';
export { resolveLocation } from './geo/resolve.js';
export type { ResolvedLocation, ResolveResult } from './geo/resolve.js';

/* ---------------------------------- types --------------------------------- */

export type {
  // Data
  Attack,
  AttackLocation,
  LatLng,
  RegionCode,
  RegionKind,
  ResolvedRegion,
  Severity,
  Threat,
  // Aggregation
  AggregationConfig,
  AggregationGranularity,
  AggregationGroupBy,
  AggregationKeyFn,
  AggregationSeverityFn,
  IntensityScale,
  // Presentation
  AnimationConfig,
  Color,
  EasingName,
  LineStyleConfig,
  RegionsConfig,
  ThreatMapTheme,
  // Projection
  GeoProjectionLike,
  ProjectionName,
  ProjectionSpec,
  // Render hooks
  RegionRenderContext,
  RegionRenderer,
  ThreatRenderContext,
  ThreatRenderer,
  // Geo data
  GeoData,
  GeoFeature,
  GeoFeatureCollection,
  GeoGeometry,
  // Component
  ThreatMapError,
  ThreatMapProps,
} from './types.js';
