/**
 * Vercel serverless function: GET /api/indices
 *
 * Pulls keyless public market data and returns it in the shape the app expects.
 *  - FRED CSV downloads (IMF/World Bank monthly commodity prices, EIA Brent)
 *  - Yahoo Finance chart endpoint (SOX index, REMX ETF as rare-earth proxy)
 *
 * Any source that fails is simply omitted; the client falls back to src/data.ts.
 * No API keys or env vars required.
 */

// Minimal types so no extra dependency (@vercel/node) is needed.
type Res = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void };
};

type Point = [month: string, value: number]; // ["2026-09", 9876.5]

interface Source {
  /** Must match the `name` of an entry in MARKET_INDICES (src/data.ts) exactly. */
  name: string;
  kind: 'fred' | 'yahoo';
  id: string;
  /**
   * true  = real price in the same unit as data.ts -> overrides currentValue.
   * false = proxy series -> only change3m / history are used, currentValue stays static.
   */
  exact: boolean;
}

const SOURCES: Source[] = [
  { name: 'LME Copper',   kind: 'fred',  id: 'PCOPPUSDM',    exact: true  },
  { name: 'LME Aluminum', kind: 'fred',  id: 'PALUMUSDM',    exact: true  },
  { name: 'LME Nickel',   kind: 'fred',  id: 'PNICKUSDM',    exact: true  },
  { name: 'LME Zinc',     kind: 'fred',  id: 'PZINCUSDM',    exact: true  },
  { name: 'Brent Crude',  kind: 'fred',  id: 'DCOILBRENTEU', exact: true  },
  { name: 'SGX Rubber',   kind: 'fred',  id: 'PRUBBUSDM',    exact: true  },
  { name: 'LME Steel',    kind: 'fred',  id: 'PIORECRUSDM',  exact: false }, // iron ore as steel proxy
  { name: 'SOX Index',    kind: 'yahoo', id: '^SOX',         exact: true  },
  { name: 'Rare Earth Index', kind: 'yahoo', id: 'REMX',     exact: false }, // REMX ETF as proxy
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TIMEOUT_MS = 8000;

/** Collapse any series to one value per month (last observation wins), sorted ascending. */
function toMonthly(rows: { date: string; v: number }[]): Point[] {
  const byMonth = new Map<string, number>();
  for (const r of rows) byMonth.set(r.date.slice(0, 7), r.v);
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function loadFred(id: string): Promise<{ months: Point[]; latest: number }> {
  const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`FRED ${id}: HTTP ${r.status}`);

  const cutoff = new Date(Date.now() - 240 * 86400_000).toISOString().slice(0, 10);
  const rows = (await r.text())
    .trim()
    .split('\n')
    .slice(1) // header
    .map(line => line.split(','))
    .filter(([d, v]) => d >= cutoff && v && v !== '.' && !Number.isNaN(+v))
    .map(([d, v]) => ({ date: d, v: +v }));

  if (rows.length < 2) throw new Error(`FRED ${id}: not enough data`);
  return { months: toMonthly(rows), latest: rows[rows.length - 1].v };
}

async function loadYahoo(symbol: string): Promise<{ months: Point[]; latest: number }> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=8mo&interval=1mo`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AutoDriveTwin/1.0)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`Yahoo ${symbol}: HTTP ${r.status}`);

  const result = (await r.json())?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol}: empty response`);

  const ts: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const rows = ts
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), v: closes[i] }))
    .filter((x): x is { date: string; v: number } => typeof x.v === 'number');

  if (rows.length < 2) throw new Error(`Yahoo ${symbol}: not enough data`);
  const latest = result.meta?.regularMarketPrice ?? rows[rows.length - 1].v;
  return { months: toMonthly(rows), latest };
}

export default async function handler(_req: unknown, res: Res) {
  // Cache at Vercel's edge for 6h; serve stale for up to a day while revalidating.
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');

  const settled = await Promise.allSettled(
    SOURCES.map(async src => {
      const data = src.kind === 'fred' ? await loadFred(src.id) : await loadYahoo(src.id);
      return { src, ...data };
    })
  );

  const indices: { name: string; change3m: number; currentValue?: number; proxy: boolean }[] = [];
  // month key -> { seriesName: % change vs first month in window }
  const history: Record<string, Record<string, number>> = {};
  const failed: string[] = [];

  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      failed.push(SOURCES[i].name);
      return;
    }
    const { src, months, latest } = r.value;
    if (months.length < 2) return;

    const past = months[Math.max(0, months.length - 4)][1]; // ~3 months back
    const change3m = +(((latest / past) - 1) * 100).toFixed(1);

    indices.push({
      name: src.name,
      change3m,
      ...(src.exact ? { currentValue: +latest.toFixed(2) } : {}),
      proxy: !src.exact,
    });

    const window = months.slice(-6);
    const base = window[0][1];
    for (const [m, v] of window) {
      (history[m] ??= {})[src.name] = +(((v / base) - 1) * 100).toFixed(1);
    }
  });

  const historical = Object.entries(history)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, vals]) => ({ month: MONTHS[+m.slice(5, 7) - 1], ...vals }));

  res.status(200).json({
    indices,
    historical,
    failed,
    updatedAt: new Date().toISOString(),
  });
}
