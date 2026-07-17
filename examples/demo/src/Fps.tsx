import { useEffect, useRef, useState } from 'react';

/**
 * A frame-rate readout.
 *
 * Present so the heavy-load demo's performance claim is observable rather than
 * asserted — if 500 animated threats ever stop holding 60fps, this is where it
 * shows.
 */
export function Fps(): JSX.Element {
  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  const since = useRef(performance.now());

  useEffect(() => {
    let handle = 0;
    const tick = () => {
      frames.current++;
      const now = performance.now();
      const elapsed = now - since.current;
      if (elapsed >= 500) {
        setFps(Math.round((frames.current * 1000) / elapsed));
        frames.current = 0;
        since.current = now;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);

  const tone = fps >= 55 ? '#22c55e' : fps >= 30 ? '#fbbf24' : '#ef4444';

  return (
    <div className="fps" style={{ color: tone }}>
      {fps} fps
    </div>
  );
}
