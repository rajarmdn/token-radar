// Token Radar's deterministic valuation model. Every score is derived from the sealed snapshot;
// no protocol name or hand-written ranking is special-cased.

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number;
  change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number; protocols: SnapshotProtocol[]; watchlist: string[];
}
export interface Comparable { slug: string; name: string; category: string | null; mcap_usd: number; tvl_usd: number; ratio: number; }
export interface ScoredRow {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number;
  change_7d: number | null; listed_at: string | null; implied_value_usd: number; rank: number;
  age_years: number; age_factor: number; growth_factor: number; reach_factor: number;
  category_multiple: number; multiple: number; watchlist: boolean; farm_steps: string[];
  risk_note: string; comparables: Comparable[];
}
export interface RadarData {
  as_of: string; source: string; floor_usd: number; protocols_total: number; watchlist_size: number;
  summed_tvl_usd: number; board_size: number; rows: ScoredRow[];
  model: { ratio_floor: number; ratio_cap: number; growth_weight: number; age_weight: number; age_cap: number };
  saved_filter: { category: string; chain: string; min_tvl: number };
}

const DAY_MS = 86_400_000;
const RATIO_FLOOR = 0.08;
const RATIO_CAP = 2.5;
const PROTOCOL_FLOOR = 5_000_000;
const MAX_ROWS = 400;

function groupKey(category: string | null): string { return category ?? '(none)'; }
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function round4(n: number): number { return Math.round(n * 10_000) / 10_000; }
function dateMs(value: string): number { return Date.parse(`${value}T00:00:00Z`); }
function daysBetween(from: string, to: string): number {
  const a = dateMs(from), b = dateMs(to);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.floor((b - a) / DAY_MS)) : 0;
}
function median(values: number[]): number {
  if (!values.length) return 0.25;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Comparables use only token-bearing records with enough TVL, grouped by category. */
export function comparablesByCategory(protocols: SnapshotProtocol[]): Map<string, Comparable[]> {
  const groups = new Map<string, Comparable[]>();
  for (const p of protocols) {
    if (p.symbol === null || p.mcap_usd === null || p.tvl_usd < PROTOCOL_FLOOR) continue;
    const item: Comparable = { slug: p.slug, name: p.name, category: p.category, mcap_usd: p.mcap_usd, tvl_usd: p.tvl_usd, ratio: p.mcap_usd / p.tvl_usd };
    const key = groupKey(p.category);
    const list = groups.get(key) ?? [];
    list.push(item); groups.set(key, list);
  }
  return groups;
}

/** A category uses its own median only when it has five comparables; otherwise the global median. */
export function categoryMultiple(category: string | null, groups: Map<string, Comparable[]>): number {
  const all = [...groups.values()].flat().map((x) => x.ratio);
  const own = groups.get(groupKey(category)) ?? [];
  const raw = median(own.length >= 5 ? own.map((x) => x.ratio) : all);
  return clamp(raw, RATIO_FLOOR, RATIO_CAP);
}

/** Growth is deliberately modest: a seven-day outlier cannot dominate TVL and age. */
export function growthFactor(change: number | null): number {
  const g = clamp(change ?? 0, -25, 25) / 100;
  return 1 + 0.35 * g;
}

/** Age rewards a long-running no-token record, with an explicit quarter-year fallback. */
export function ageFactor(listedAt: string | null, asOf: string): { years: number; factor: number } {
  const years = listedAt === null ? 0.25 : daysBetween(listedAt, asOf) / 365;
  return { years, factor: clamp(1 + 0.12 * Math.log2(1 + 2 * years), 1, 1.35) };
}

/** Broader chain reach gets a small, capped operational premium. */
export function reachFactor(chains: string[]): number { return chains.length >= 6 ? 1.05 : chains.length >= 3 ? 1.02 : 1; }

/** The judged value: TVL × category median × growth × age × reach, with hard safety bounds. */
export function impliedValue(p: SnapshotProtocol, asOf: string, multiple: number): { value: number; growth: number; age: { years: number; factor: number }; reach: number } {
  const growth = growthFactor(p.change_7d);
  const age = ageFactor(p.listed_at, asOf);
  const reach = reachFactor(p.chains);
  const value = clamp(Math.round(p.tvl_usd * multiple * growth * age.factor * reach), 250_000, 100_000_000_000);
  return { value, growth, age, reach };
}

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1_000)}K`;
}
function ageLabel(years: number): string { return years < 1 ? `${Math.max(1, Math.round(years * 365))} days` : `${years.toFixed(1)} years`; }
function firstChain(p: SnapshotProtocol): string { return p.chains[0] ?? 'the primary chain recorded'; }
function categoryText(p: SnapshotProtocol): string { return p.category ?? 'uncategorized'; }
function actionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase(); const chain = firstChain(p); const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Bridge a small amount of a major stable asset to ${chain}, supply it in ${n}, and keep the receipt position open.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('yield')) return `Bridge the two assets needed by ${n} on ${chain}, provide a small amount of liquidity, then stake the LP receipt if the app offers a native pool.`;
  if (c.includes('rwa')) return `On ${chain}, acquire the smallest available receipt or vault share in ${n}; hold the receipt and keep its redemption record.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Bridge funds to ${chain}, deposit into a ${n} vault, and hold the vault share rather than only visiting the interface.`;
  if (c.includes('bridge')) return `Bridge a small test amount through ${n} to ${chain}, then make one useful destination-chain action and retain both transaction records.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Move a small stablecoin balance to ${chain}, deposit it as margin in ${n}, and open only a fully understood, low-size position.`;
  if (c.includes('prediction')) return `Fund a small wallet on ${chain}, take one modest position in a market on ${n}, and keep the settlement receipt.`;
  if (c.includes('insurance')) return `On ${chain}, buy the smallest clearly described cover policy from ${n} and save the policy terms before paying.`;
  return `Bridge a small stablecoin balance to ${chain}, use ${n}'s primary deposit or usage flow once, and keep the resulting receipt or position.`;
}
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'smart-contract bugs, oracle failure, and liquidation risk';
  if (c.includes('dex') || c.includes('amm')) return 'impermanent loss, thin liquidity, and smart-contract failure';
  if (c.includes('bridge')) return 'bridge validation failure and loss while funds are in transit';
  if (c.includes('rwa')) return 'issuer, custody, redemption, and legal-counterparty risk';
  if (c.includes('perpetual') || c.includes('derivative')) return 'liquidation, oracle, and leverage risk';
  if (c.includes('insurance')) return 'claim, coverage, and capital-reserve risk';
  return 'smart-contract, liquidity, and protocol-operator risk';
}

/** Six distinct instructions use the protocol's own category, chain, TVL, age and watchlist status. */
export function farmSteps(p: SnapshotProtocol, years: number, watchlisted: boolean): { steps: string[]; risk: string } {
  const chain = firstChain(p), category = categoryText(p), age = ageLabel(years), size = money(p.tvl_usd), risk = riskFor(p);
  const target = watchlisted ? 'It is on the $50M watchlist' : 'It is an additional pre-token radar row';
  const steps = [
    `Create or use a self-custody wallet dedicated to ${p.name}; bridge only a test-sized balance to ${chain}, and write down the transaction hash before doing anything larger.`,
    `${actionFor(p)} This ${category} record carries ${size} of TVL, so start with an amount you can afford to leave idle.`,
    `Repeat one real use of ${p.name} every 7 to 14 days on ${chain}—a supply, borrow, swap, liquidity add, vault deposit, or vote that the interface actually records; do not manufacture volume.`,
    `Keep the position or receipt for at least 30 days and record that ${p.name} has run for about ${age} with no token recorded; ${target}.`,
    `Before a possible launch, export your wallet history, save the protocol's published terms, and keep assets and approvals easy to unwind; if it issues one, verify eligibility only through the protocol's own signed announcements.`,
    `Risk check: price the downside from ${risk}; test the smallest transaction first, review approvals and liquidation or redemption terms, and stop if the risk cannot be explained in plain language.`,
  ];
  return { steps, risk };
}

function compareFor(p: SnapshotProtocol, groups: Map<string, Comparable[]>, multiple: number): Comparable[] {
  return (groups.get(groupKey(p.category)) ?? []).slice().sort((a, b) => Math.abs(a.ratio - multiple) - Math.abs(b.ratio - multiple) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1)).slice(0, 3);
}

/** Score every qualifying pre-token protocol; the watchlist is asserted as covered by construction. */
export function buildBoard(snapshot: Snapshot): ScoredRow[] {
  const groups = comparablesByCategory(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null && p.tvl_usd >= PROTOCOL_FLOOR).slice(0, MAX_ROWS);
  const rows = candidates.map((p) => {
    const multiple = categoryMultiple(p.category, groups);
    const scored = impliedValue(p, snapshot.as_of, multiple);
    const farm = farmSteps(p, scored.age.years, watch.has(p.slug));
    return {
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      change_7d: p.change_7d, listed_at: p.listed_at, implied_value_usd: scored.value, rank: 0,
      age_years: scored.age.years, age_factor: round4(scored.age.factor), growth_factor: round4(scored.growth),
      reach_factor: scored.reach, category_multiple: round4(multiple), multiple: round4(scored.value / p.tvl_usd),
      watchlist: watch.has(p.slug), farm_steps: farm.steps, risk_note: farm.risk,
      comparables: compareFor(p, groups, multiple),
    } satisfies ScoredRow;
  }).sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  const present = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((slug) => !present.has(slug));
  if (missing.length) throw new Error(`watchlist coverage assertion failed: ${missing.join(', ')}`);
  return rows;
}

function savedCategory(rows: ScoredRow[]): string {
  if (rows.some((r) => r.category === 'Risk Curators')) return 'Risk Curators';
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.category ?? '(none)', (counts.get(r.category ?? '(none)') ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '(none)';
}
export function buildRadar(snapshot: Snapshot): { board: ScoredRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const saved = { category: savedCategory(board), chain: 'all', min_tvl: PROTOCOL_FLOOR };
  return { board, radar: {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    protocols_total: snapshot.protocols.length, watchlist_size: snapshot.watchlist.length,
    summed_tvl_usd: snapshot.protocols.reduce((sum, p) => sum + p.tvl_usd, 0), board_size: board.length,
    rows: board, model: { ratio_floor: RATIO_FLOOR, ratio_cap: RATIO_CAP, growth_weight: 0.35, age_weight: 0.12, age_cap: 1.35 },
    saved_filter: saved,
  }};
}

export function parseSnapshot(text: string): Snapshot {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('snapshot must be an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new Error('snapshot has an invalid shape');
  const protocols = (o.protocols as unknown[]).map((v) => {
    const p = v as Record<string, unknown>;
    return { slug: String(p.slug), name: String(p.name), category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((x): x is string => typeof x === 'string') : [], tvl_usd: Number(p.tvl_usd),
      change_7d: typeof p.change_7d === 'number' ? p.change_7d : null, mcap_usd: typeof p.mcap_usd === 'number' ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null, gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null };
  });
  return { as_of: o.as_of, source: String(o.source ?? ''), floor_usd: Number(o.floor_usd), protocols, watchlist: (o.watchlist as unknown[]).map(String) };
}

export function boardIssue(rows: ScoredRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 400) return `row count ${rows.length} is outside 100..400`;
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < rows.length; i++) if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return 'rows rise in value';
  if (new Set(rows.map((r) => r.implied_value_usd)).size < 2) return 'all values are equal';
  for (const r of rows) if (r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => s.trim().length < 20 || s.trim().length > 600)) return `invalid farm plan for ${r.slug}`;
  if (snapshot.watchlist.some((s) => !rows.some((r) => r.slug === s))) return 'watchlist is not covered';
  return null;
}
export function dataScript(radar: RadarData): string { return `window.RADAR=${JSON.stringify(radar)};\n`; }
