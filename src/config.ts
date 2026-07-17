/**
 * Default theme and configuration objects.
 *
 * Every one is exported and frozen, so you can read them, spread them, or derive
 * your own variants:
 *
 * ```ts
 * import { defaultTheme } from 'react-threat-map';
 * const lightTheme = { ...defaultTheme, ocean: '#f4f6fa', land: '#d8dfe8' };
 * ```
 *
 * @packageDocumentation
 */

import type { AnimationConfig, LineStyleConfig, RegionsConfig, ThreatMapTheme } from './types.js';

/**
 * The default dark theme.
 *
 * Tuned for a SOC wall display: a desaturated navy map so that saturated threat
 * lines carry all the visual salience. Severity runs cyan → amber → orange → red,
 * which reads as escalating for viewers with the common forms of colour-vision
 * deficiency because it varies lightness as well as hue.
 */
export const defaultTheme: ThreatMapTheme = Object.freeze({
  ocean: '#080c18',
  land: '#18213a',
  border: '#2b3858',
  borderWidth: 0.5,
  stateBorder: '#212c4a',
  stateBorderWidth: 0.4,
  severityColors: Object.freeze({
    low: '#22d3ee',
    medium: '#fbbf24',
    high: '#fb7185',
    critical: '#ef4444',
  }),
  headColor: '#ffffff',
  originColor: '#64748b',
  impactColor: '#ffffff',
});

/** Default arc geometry and styling. */
export const defaultLineStyle: LineStyleConfig = Object.freeze({
  curvature: 0.22,
  width: 1.2,
  trackOpacity: 0.28,
  trailOpacity: 0.95,
  trailLength: 0.18,
  glow: 0.5,
  headRadius: 2,
  showOrigin: true,
  showImpact: true,
  segments: 48,
});

/** Default animation settings. */
export const defaultAnimation: AnimationConfig = Object.freeze({
  enabled: true,
  speed: 0.5,
  easing: 'easeInOutQuad',
  stagger: 1,
  loop: true,
  fadeIn: 400,
  fadeOut: 600,
  respectReducedMotion: true,
});

/** Default boundary-drawing settings. */
export const defaultRegions: RegionsConfig = Object.freeze({
  showCountries: true,
  showStates: false,
  showGraticule: false,
  graticuleColor: 'rgba(255,255,255,0.05)',
  showSphere: true,
});
