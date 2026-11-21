import { useEffect, useState } from 'react';
import { MARKET_INDICES, HISTORICAL_SHOCKS } from './data';

type Index = (typeof MARKET_INDICES)[number];
type HistoryRow = (typeof HISTORICAL_SHOCKS)[number];

interface LiveIndex {
  name: string;
  change3m: number;
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

  return { indices, historical, live, updatedAt };
}
