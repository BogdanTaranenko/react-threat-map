/**
 * The demo scenarios.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ThreatMap,
  defaultTheme,
  type Attack,
  type RegionRenderer,
  type Threat,
  type ThreatMapTheme,
} from 'react-threat-map';

import { GHANA_CAMPAIGN, makeAttacks, makeAttack, makeCampaignAttacks, makeCoordinateAttacks } from './feed';
import { Fps } from './Fps';

/* ------------------------------ 1. basic usage ----------------------------- */

/**
 * The headline case: attacks in, map out. No configuration at all.
 */
export function BasicDemo(): JSX.Element {
  const attacks = useMemo<Attack[]>(
    () => [
      { id: '1', from: 'CN', to: 'US-CA', severity: 'high' },
      { id: '2', from: 'RU', to: 'US-NY', severity: 'critical' },
      { id: '3', from: 'BR', to: 'FR', severity: 'medium' },
      { id: '4', from: 'IR', to: 'GB', severity: 'high' },
      { id: '5', from: 'KP', to: 'JP', severity: 'critical' },
      { id: '6', from: 'US-TX', to: 'DE', severity: 'low' },
    ],
    [],
  );

  return (
    <Panel
      title="Basic usage"
      description="Six attacks, no configuration. Region codes resolve to coordinates automatically."
      code={`<ThreatMap attacks={attacks} />`}
    >
      <ThreatMap attacks={attacks} />
    </Panel>
  );
}

/* ------------------------------ 2. heavy load ------------------------------ */

/**
 * 500+ attacks streaming in, to demonstrate the performance claim.
 *
 * The FPS counter is the point of this demo: it is the visible evidence for the
 * Canvas-over-SVG decision in DECISIONS.md §2.
 */
export function HeavyLoadDemo(): JSX.Element {
  const [attacks, setAttacks] = useState<Attack[]>(() => makeAttacks(500));
  const [streaming, setStreaming] = useState(true);

  useEffect(() => {
    if (!streaming) return;

    // Add ~20/sec and drop the oldest, holding a steady ~500 in flight — the
    // shape of a real SOC feed.
    const timer = setInterval(() => {
      setAttacks((previous) => [...previous.slice(-480), ...Array.from({ length: 20 }, makeAttack)]);
    }, 1000);

    return () => clearInterval(timer);
  }, [streaming]);

  return (
    <Panel
      title="Heavy load — 500+ concurrent threats"
      description={
        <>
          {attacks.length} attacks streaming at ~20/sec, aggregated by origin region. Watch the FPS counter: draw
          calls scale with the number of distinct styles, not with the number of threats.
        </>
      }
      code={`<ThreatMap attacks={attacks} regions={{ showStates: true }} />`}
      actions={
        <button className="btn" onClick={() => setStreaming((s) => !s)}>
          {streaming ? 'Pause stream' : 'Resume stream'}
        </button>
      }
    >
      <Fps />
      <ThreatMap attacks={attacks} regions={{ showStates: true }} animation={{ speed: 0.6 }} />
    </Panel>
  );
}

/* ---------------------------- 3. custom theming ---------------------------- */

const LIGHT_THEME: Partial<ThreatMapTheme> = {
  ocean: '#eef2f7',
  land: '#cfd9e6',
  border: '#ffffff',
  borderWidth: 0.7,
  stateBorder: '#e2e8f0',
  severityColors: {
    low: '#0891b2',
    medium: '#ca8a04',
    high: '#ea580c',
    critical: '#dc2626',
  },
  headColor: '#1e293b',
};

/**
 * A light theme, a different projection, straighter lines, and a `renderThreat`
 * hook that labels the heaviest aggregates.
 */
export function ThemingDemo(): JSX.Element {
  const attacks = useMemo(() => makeAttacks(160), []);

  return (
    <Panel
      title="Custom theming & render hooks"
      description="A light palette, equirectangular projection, flatter arcs, and a renderThreat hook labelling aggregates of 8+."
      code={`<ThreatMap
  attacks={attacks}
  projection="equirectangular"
  theme={{ ocean: '#eef2f7', land: '#cfd9e6', ... }}
  line={{ curvature: 0.08, width: 1.6, glow: 0.2 }}
  renderThreat={(ctx, { threat, points, alpha }) => {
    if (threat.count < 8) return false;      // built-in renderer handles it
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 10px system-ui';
    ctx.fillText(String(threat.count), points[0] + 4, points[1] - 4);
    return false;                            // still draw the line underneath
  }}
/>`}
    >
      <ThreatMap
        attacks={attacks}
        projection="equirectangular"
        theme={LIGHT_THEME}
        line={{ curvature: 0.08, width: 1.6, glow: 0.2, trackOpacity: 0.35 }}
        animation={{ speed: 0.4, easing: 'linear' }}
        renderThreat={(ctx, { threat, points, alpha }) => {
          if (threat.count < 8) return false;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = '#0f172a';
          ctx.font = '600 10px system-ui, sans-serif';
          ctx.fillText(String(threat.count), (points[0] as number) + 4, (points[1] as number) - 4);
          return false;
        }}
      />
    </Panel>
  );
}

/* -------------------------- 4. aggregation compare ------------------------- */

/**
 * The same feed rendered with aggregation on and off, side by side.
 *
 * This is the clearest possible statement of what aggregation buys you: the
 * left map is legible, the right one is a hairball.
 */
export function AggregationDemo(): JSX.Element {
  const [mode, setMode] = useState<'auto' | 'country' | 'off'>('auto');
  const attacks = useMemo(() => makeAttacks(300), []);

  const aggregation = mode === 'off' ? (false as const) : { granularity: mode, minCount: 1 as const };

  const counts = { auto: 'US states stay separate', country: 'US collapses to one origin', off: 'one line per attack' };

  return (
    <Panel
      title="Aggregation strategies"
      description={`300 attacks, ${counts[mode]}. Compare the legibility of each mode.`}
      code={
        mode === 'off'
          ? `<ThreatMap attacks={attacks} aggregation={false} />`
          : `<ThreatMap attacks={attacks} aggregation={{ granularity: '${mode}' }} />`
      }
      actions={
        <div className="segmented">
          {(['auto', 'country', 'off'] as const).map((option) => (
            <button
              key={option}
              className={`btn ${mode === option ? 'btn-active' : ''}`}
              onClick={() => setMode(option)}
            >
              {option === 'auto' ? 'auto (state)' : option === 'country' ? 'country' : 'disabled'}
            </button>
          ))}
        </div>
      }
    >
      <ThreatMap attacks={attacks} aggregation={aggregation} regions={{ showStates: mode === 'auto' }} />
    </Panel>
  );
}

/* ------------------------ 5. reverse geocoding + hover --------------------- */

/**
 * Raw coordinates with no region codes, aggregated via point-in-polygon, plus
 * hover interaction.
 */
export function CoordinatesDemo(): JSX.Element {
  const attacks = useMemo(() => makeCoordinateAttacks(240), []);
  const [hovered, setHovered] = useState<Threat | null>(null);
  const position = useRef({ x: 0, y: 0 });

  return (
    <Panel
      title="Raw coordinates & interaction"
      description="240 attacks given only {lat, lng} — no region codes. The library reverse-resolves each point to its state or country, then aggregates. Hover a line."
      code={`<ThreatMap
  attacks={attacks}                       // from: { lat: 34.05, lng: -118.24 }
  onThreatHover={(threat) => setHovered(threat)}
/>`}
    >
      <div style={{ position: 'relative' }}>
        <ThreatMap
          attacks={attacks}
          regions={{ showStates: true }}
          onThreatHover={(threat, event) => {
            position.current = { x: event.offsetX, y: event.offsetY };
            setHovered(threat);
          }}
        />
        {hovered ? (
          <div className="tooltip" style={{ left: position.current.x + 12, top: position.current.y + 12 }}>
            <strong>
              {hovered.fromRegion.name} → {hovered.toRegion.name}
            </strong>
            <div>
              {hovered.count} attack{hovered.count === 1 ? '' : 's'} · {hovered.severity}
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/* -------------------------- 6. one target, highlighted --------------------- */

/** The country under attack. */
const TARGET = 'GH';

/** Ghana's highlight color. Deliberately outside `severityColors`, so it reads as "target", not "severity". */
const TARGET_COLOR = '#f97316';

/**
 * Repaint the target country and leave every other region to the built-in
 * renderer.
 *
 * Defined at module scope, not inline: `renderRegion` is a dependency of the
 * base map's redraw effect, so a fresh closure each render would re-rasterize
 * all 177 outlines on every render.
 */
const highlightTarget: RegionRenderer = (ctx, { feature, id, path }) => {
  if (id !== TARGET) return false;

  // No save/restore is done around this hook, and the countries that follow are
  // drawn in one batched fill — leaking a shadow would smear across all of them.
  ctx.save();
  ctx.beginPath();
  path(feature);
  // Ghana covers a few pixels at world scale, so the halo does the work the fill
  // is too small to do on its own.
  ctx.shadowColor = TARGET_COLOR;
  ctx.shadowBlur = 18;
  ctx.fillStyle = TARGET_COLOR;
  ctx.fill();
  ctx.restore();

  return true;
};

/**
 * Five origins, five very different attack volumes, one target country.
 *
 * Two things are on display: aggregation turning 109 attacks into five lines
 * whose weight tracks their count, and `renderRegion` picking a single country
 * out of the base map.
 */
export function TargetedDemo(): JSX.Element {
  const attacks = useMemo(() => makeCampaignAttacks(GHANA_CAMPAIGN, TARGET), []);
  const total = GHANA_CAMPAIGN.reduce((sum, origin) => sum + origin.count, 0);

  return (
    <Panel
      title="One target under fire"
      description={`${total} attacks from five countries, all aimed at Ghana. Each origin collapses to one line, weighted by its attack count — so Russia's 48 read heavier than Vietnam's 4. The target itself is highlighted through the renderRegion hook.`}
      code={`<ThreatMap
  attacks={attacks}                        // ${total} attacks, every one { to: '${TARGET}' }
  renderRegion={(ctx, { feature, id, path }) => {
    if (id !== 'GH') return false;         // built-in renderer handles the rest
    ctx.save();
    ctx.beginPath();
    path(feature);
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.restore();
    return true;                           // we drew it
  }}
/>`}
    >
      <div style={{ position: 'relative' }}>
        <ThreatMap attacks={attacks} renderRegion={highlightTarget} line={{ curvature: 0.28 }} />
        <ul className="legend">
          {GHANA_CAMPAIGN.map((origin) => (
            <li key={origin.region}>
              <span className="legend-dot" style={{ background: defaultTheme.severityColors[origin.severity] }} />
              {origin.name}
              <span className="legend-count">{origin.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/* --------------------------------- layout ---------------------------------- */

interface PanelProps {
  readonly title: string;
  readonly description: React.ReactNode;
  readonly code: string;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
}

function Panel({ title, description, code, actions, children }: PanelProps): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {actions}
      </header>
      <div className="map-frame">{children}</div>
      <pre className="code">{code}</pre>
    </section>
  );
}
