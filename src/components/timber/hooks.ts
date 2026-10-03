"use client";

import * as React from "react";
import { apiGet } from "@/lib/api-client";

/**
 * Minimal fetch hook: loading / error / data + manual reload.
 * `path` identity or any entry in `deps` triggers a refetch.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState<boolean>(Boolean(path));
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<T>(path);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [path]);

  React.useEffect(() => {
    void load();
  }, [load, ...deps]);

  return { data, loading, error, reload: load, setData };
}

/** rAF count-up used by KPI numbers; re-animates whenever `target` changes.
 *  Intermediate frames are rounded to integers so the tween never displays
 *  glitchy fractional currency/quantities (e.g. "₹27,36,470.4"). */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = React.useState(0);
  const fromRef = React.useRef(0);

  React.useEffect(() => {
    const to = Number.isFinite(target) ? target : 0;
    const from = Math.round(fromRef.current);
    fromRef.current = to;
    if (from === Math.round(to)) {
      setValue(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        // Intermediate frames stay integer-clean; the FINAL frame snaps to the
        // exact target so decimal KPIs (e.g. waste 8.4%) end precise.
        setValue(Math.round(from + (to - from) * eased));
        raf = requestAnimationFrame(tick);
      } else {
        setValue(to);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}
