import { useEffect, useMemo, useState } from 'react';
import { MARKET_INDICES, HISTORICAL_SHOCKS } from './data';

type Index = (typeof MARKET_INDICES)[number] & { avgMonthly?: number };
type HistoryRow = (typeof HISTORICAL_SHOCKS)[number];

interface LiveIndex {
  name: string;
  change3m: number;
  avgMonthly?: number;
  currentValue?: number;
  proxy?: boolean;
}

/**
 * Returns market indices + history. Starts with the static data from data.ts and
 * overlays live values from /api/indices when available. If the API is missing
 * (e.g. plain `vite` dev) or fails, the static data is used unchanged.
 */
export function useMarketIndices() {
  const [indices, setIndices] = useState<Index[]>(MARKET_INDICES);
  const [historical, setHistorical] = useState<HistoryRow[]>(HISTORICAL_SHOCKS);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/indices')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (cancelled || !Array.isArray(d?.indices) || d.indices.length === 0) return;

        setIndices(prev =>
          prev.map(p => {
            const l: LiveIndex | undefined = d.indices.find((x: LiveIndex) => x.name === p.name);
            if (!l) return p;
            return {
              ...p,
              change3m: l.change3m,
              ...(l.avgMonthly !== undefined ? { avgMonthly: l.avgMonthly } : {}),
              ...(l.currentValue !== undefined ? { currentValue: l.currentValue } : {}),
            };
          })
        );

        if (Array.isArray(d.historical) && d.historical.length > 1) {
          setHistorical(d.historical);
        }
        setLive(true);
        setUpdatedAt(d.updatedAt ?? null);
      })
      .catch(() => {
        /* keep static fallback */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Default slider position for each index: the average monthly % change over the last
  // 3 months (live), or change3m / 3 as an approximation when running on static data.
  // To start sliders from the full 3-month move instead, use `idx.change3m`.
  // useMemo keeps the object identity stable so effects depending on it don't re-fire every render.
  const baseline = useMemo(() => {
    const b: Record<string, number> = {};
    for (const idx of indices) {
      const v = idx.avgMonthly ?? idx.change3m / 3;
      b[idx.name] = Math.round(v * 2) / 2; // snap to the slider's 0.5 step
    }
    return b;
  }, [indices]);

  return { indices, historical, baseline, live, updatedAt };
}
