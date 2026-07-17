import { AggregationDemo, BasicDemo, CoordinatesDemo, HeavyLoadDemo, TargetedDemo, ThemingDemo } from './demos';

export function App(): JSX.Element {
  return (
    <main>
      <header className="site-head">
        <h1>react-threat-map</h1>
        <p>
          Animated cyberattack threats on a static world map, with per-region aggregation and first-class US state
          support.
        </p>
      </header>

      <BasicDemo />
      <HeavyLoadDemo />
      <TargetedDemo />
      <AggregationDemo />
      <ThemingDemo />
      <CoordinatesDemo />

      <footer className="site-foot">
        MIT licensed · Boundaries from <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain)
      </footer>
    </main>
  );
}
