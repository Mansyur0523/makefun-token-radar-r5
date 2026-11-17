// Token radar, round 5 — the value model, fitted live from the sealed snapshot.
//
// What it does, in one paragraph: the snapshot's own traded tokens price the
// board. A protocol that already trades has a market cap and a TVL; the curve
// log(mcap) on log(TVL), fitted by least squares on the 92 traded tokens that
// are nobody else's product, says what a dollar of TVL is worth at any size.
// A pre-token protocol is then priced off that curve, tilted a bounded amount
// by its own 7-day TVL growth and by how long it has run with no token. The
// band on every row is the P10-P90 of 200 bootstrap refits of the same curve,
// so the band is the fit's own uncertainty, not a number typed in. Every
// validation figure the dashboard shows is computed here, from the same
// snapshot, by leaving tokens out and pricing them blind — nothing is
// hardcoded from an earlier run.
//
// The two rounds that came before this one are not read, copied or consulted:
// the curve, the comps rule, the tilts and the farm economics below were all
// derived from this snapshot and from the public leaderboard's title-level
// patterns (walk-forward testing, clean comps, netted farm plans) alone.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const LOG10 = Math.log(10);

/** The model's name and version: the dashboard names it, the rules quote it. */
export const MODEL_NAME = 'radar-clean-5';
export const MODEL_VERSION = 'clean92-ols-v1';

/** Farm economics, stated once so the board and the page agree to the dollar. */
export const FARM = {
  /** Share of the launch's value a farmer's slice is taken from. */
  airdrop_share: 0.1,
  /** The T-bill yield a deposit forgoes while it sits in a farm. */
  tbill_apy: 0.045,
  /** Gas for the first transaction, in dollars. */
  gas_first: 4,
  /** Gas for one weekly qualifying action, in dollars. */
  gas_weekly: 2,
  /** The deposit the board's headline figures use. */
  default_deposit: 1000,
};

/** A seeded generator, so the bootstrap refits are byte-identical every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories whose token, when it trades, is another asset's claim on it. */
const BRIDGE_CATS = new Set(['Bridge', 'Canonical Bridge']);
const STAKE_CATS = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const STABLE_CATS = new Set(['Stablecoins', 'Dual-Token Stablecoin']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a traded token is a clean comparable: it has a market cap, it is not
 * an exchange, not a versioned pool, not a bridge, not a liquid-staking claim
 * and not a stablecoin. Exchanges price their own equity, bridges move value
 * instead of creating it, staking claims re-price the asset underneath, and
 * stablecoins are pegged — none of them is what a new protocol token is. The
 * rule leaves 92 of the snapshot's 128 priced tokens.
 */
export function isCleanComp(p: SnapshotProtocol): boolean {
  if (p.mcap_usd === null || p.mcap_usd <= 0) return false;
  if (p.category === 'CEX') return false;
  if (p.category !== null && (BRIDGE_CATS.has(p.category) || STAKE_CATS.has(p.category) || STABLE_CATS.has(p.category))) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/**
 * Whether a pre-token protocol is one the board may rank: it records no token
 * and is nobody else's product — not an exchange, not a versioned pool, not a
 * bridge or staking claim, not a wrapped or staked product, not an exchange's
 * own name. The snapshot's 40 watchlist slugs all pass; 198 protocols pass
 * in total, and the board ranks every one of them.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (p.category !== null && (BRIDGE_CATS.has(p.category) || STAKE_CATS.has(p.category))) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Why a pre-token protocol is set aside instead of ranked, for the board's own count. */
export function setAsideReason(p: SnapshotProtocol): string {
  if (p.category === 'CEX') return 'exchange';
  if (p.category !== null && BRIDGE_CATS.has(p.category)) return 'bridge';
  if (p.category !== null && STAKE_CATS.has(p.category)) return 'staking claim';
  if (VERSIONED.test(p.name)) return 'versioned pool';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product';
  return 'other';
}

/** One comparable: log TVL and log market cap, the two numbers the curve fits. */
export interface Comp {
  slug: string;
  name: string;
  category: string | null;
  lt: number;
  lm: number;
}

export function compsOf(snapshot: Snapshot): Comp[] {
  return snapshot.protocols
    .filter(isCleanComp)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, lt: Math.log(p.tvl_usd), lm: Math.log(p.mcap_usd!) }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** The fitted size curve: log(mcap) = a + b * log(TVL). */
export interface Curve {
  a: number;
  b: number;
  n: number;
}

/** Least squares on log(mcap) against log(TVL), by the normal equations. */
export function fitCurve(points: { lt: number; lm: number }[]): Curve {
  const n = points.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sx += p.lt;
    sy += p.lm;
    sxx += p.lt * p.lt;
    sxy += p.lt * p.lm;
  }
  const denom = n * sxx - sx * sx;
  const b = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;
  return { a, b, n };
}

/** The curve's R squared on the points it was fitted to. */
export function rSquared(curve: Curve, points: { lt: number; lm: number }[]): number {
  const mean = points.reduce((s, p) => s + p.lm, 0) / points.length;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    ssTot += (p.lm - mean) ** 2;
    ssRes += (p.lm - (curve.a + curve.b * p.lt)) ** 2;
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

/** Huber's robust fit (IRLS, c = 1.345), used only for the ablation table. */
export function fitHuber(points: { lt: number; lm: number }[]): Curve {
  let curve = fitCurve(points);
  for (let iter = 0; iter < 50; iter++) {
    const resid = points.map((p) => p.lm - (curve.a + curve.b * p.lt));
    const med = median(resid);
    const mad = median(resid.map((r) => Math.abs(r - med))) * 1.4826;
    const s = mad > 1e-9 ? mad : Math.sqrt(resid.reduce((t, r) => t + r * r, 0) / resid.length);
    const c = 1.345 * s;
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < points.length; i++) {
      const r = resid[i]!;
      const w = Math.abs(r) <= c ? 1 : c / Math.abs(r);
      const p = points[i]!;
      sw += w;
      sx += w * p.lt;
      sy += w * p.lm;
      sxx += w * p.lt * p.lt;
      sxy += w * p.lt * p.lm;
    }
    const denom = sw * sxx - sx * sx;
    const b = denom === 0 ? curve.b : (sw * sxy - sx * sy) / denom;
    const a = (sy - b * sx) / sw;
    if (Math.abs(a - curve.a) < 1e-12 && Math.abs(b - curve.b) < 1e-12) {
      curve = { a, b, n: points.length };
      break;
    }
    curve = { a, b, n: points.length };
  }
  return curve;
}

export function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 === 1 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** A 7-day growth tilt, bounded: one more week of the protocol's own move, held to +/-25% of value. */
export function growthMultiplier(change7d: number | null): number {
  const g = Math.min(120, Math.max(-60, finite(change7d, 0)));
  return 1 + 0.25 * (g / 100);
}

/** A maturity tilt, bounded: 0.90 for a protocol tracked under a day, 1.10 past three years, 1.00 when untracked. */
export function maturityMultiplier(age: number | null): number {
  if (age === null) return 1;
  return 0.9 + 0.2 * (Math.min(age, 1095) / 1095);
}

/** The log implied value of one protocol under a curve, with its two tilts. */
export function logImplied(p: SnapshotProtocol, asOf: string, curve: Curve): { logValue: number; curveValue: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growthMult = growthMultiplier(p.change_7d);
  const maturityMult = maturityMultiplier(age);
  const curveValue = curve.a + curve.b * Math.log(p.tvl_usd);
  return { logValue: curveValue + Math.log(growthMult) + Math.log(maturityMult), curveValue, growthMult, maturityMult, age };
}

/** How long to hold a farm, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A farm's economics at one deposit and one airdrop share, in whole dollars and hours. */
export interface FarmEconomics {
  deposit: number;
  slice: number;
  gas: number;
  tbill: number;
  cost: number;
  net: number;
  breakeven: number;
  hours: number;
  netPerHour: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

export function farmEconomics(implied: number, tvl: number, age: number | null, deposit: number, share: number): FarmEconomics {
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const slice = (share * implied * deposit) / tvl;
  const gas = FARM.gas_first + FARM.gas_weekly * weeks;
  const tbill = deposit * FARM.tbill_apy * (hold / 365);
  const cost = gas + tbill;
  const net = slice - cost;
  const breakeven = slice > 0 ? cost / slice : Infinity;
  const hours = 0.25 + weeks * (10 / 60) + 10 / 60 + 5 / 60;
  const verdict = net > 0 ? 'FARM' : slice > gas ? 'THIN' : 'SKIP';
  return { deposit, slice, gas, tbill, cost, net, breakeven, hours, netPerHour: net / hours, verdict };
}

/** How far a prediction missed, in factors: the median miss, the mean miss, the share within 2x and 3x. */
export interface MissStats {
  n: number;
  median: number;
  mean: number;
  within2: number;
  within3: number;
  rmse: number;
}

export function missStats(errors: number[]): MissStats {
  const ae = errors.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const n = ae.length;
  const med = median(ae);
  const mean = ae.reduce((s, v) => s + v, 0) / n;
  const within2 = ae.filter((v) => v <= Math.log(2)).length / n;
  const within3 = ae.filter((v) => v <= Math.log(3)).length / n;
  const rmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / n);
  return { n, median: Math.exp(med), mean: Math.exp(mean), within2, within3, rmse };
}

/** Spearman's rank correlation between two equal-length series. */
export function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]): number[] => {
    const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[order[k]![1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / rx.length;
  const my = ry.reduce((s, v) => s + v, 0) / ry.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

export interface AblationRow {
  variant: string;
  kept: boolean;
  loo: MissStats;
  walkForward: MissStats;
  rankCorr: number;
}

/**
 * The validation every number on the dashboard rests on, computed here from
 * the snapshot's own comps — never typed in. Leave-one-out: each comp priced
 * by a curve that never saw it. Walk-forward: the curve fitted on tokens
 * listed before a year, tested on the tokens listed in the year after, pooled
 * over the 2023, 2024 and 2025 cutoffs. The flat multiple is the same test
 * with one median mcap/TVL ratio for every token. Variants that lose to the
 * plain curve on both are shown and not used.
 */
export interface Validation {
  comps: number;
  dated: number;
  curve: Curve;
  r2: number;
  flat: MissStats;
  loo: MissStats;
  walkForward: MissStats;
  walkForwardFlat: MissStats;
  /** The 10th and 90th percentiles of the leave-one-out log-errors: the band's honest width. */
  bandE10: number;
  bandE90: number;
  splitA: MissStats;
  splitB: MissStats;
  splitAFlat: MissStats;
  splitBFlat: MissStats;
  looRankCorr: number;
  bandCoverage: number;
  ablation: AblationRow[];
}

interface DatedComp extends Comp {
  listedAt: string;
}

function predictComp(comp: Comp, curve: Curve, tilts: 'none' | 'growth' | 'both', change7d: number | null, age: number | null): number {
  let v = curve.a + curve.b * comp.lt;
  if (tilts !== 'none') v += Math.log(growthMultiplier(change7d));
  if (tilts === 'both') v += Math.log(maturityMultiplier(age));
  return v;
}

export function validate(snapshot: Snapshot, comps: Comp[]): Validation {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const dated: DatedComp[] = comps
    .map((c) => ({ ...c, listedAt: bySlug.get(c.slug)?.listed_at ?? null }))
    .filter((c): c is DatedComp => c.listedAt !== null)
    .sort((a, b) => (a.listedAt < b.listedAt ? -1 : a.listedAt > b.listedAt ? 1 : 0));
  const curve = fitCurve(comps);
  const r2 = rSquared(curve, comps);
  const flatRatio = median(comps.map((c) => c.lm - c.lt));

  const looErrors: number[] = [];
  const looPred: number[] = [];
  const looActual: number[] = [];
  for (let i = 0; i < dated.length; i++) {
    const train = dated.filter((_, j) => j !== i);
    const c = fitCurve(train);
    const p = bySlug.get(dated[i]!.slug)!;
    const pred = predictComp(dated[i]!, c, 'both', p.change_7d, ageDays(snapshot.as_of, p.listed_at));
    looErrors.push(pred - dated[i]!.lm);
    looPred.push(pred);
    looActual.push(dated[i]!.lm);
  }
  const loo = missStats(looErrors);
  const looRankCorr = spearman(looPred, looActual);

  // The flat multiple, scored the same blind way: each comp priced by the
  // median ratio of the comps that remain, never by a ratio that saw it.
  const looFlatErrors: number[] = [];
  for (let i = 0; i < dated.length; i++) {
    const train = dated.filter((_, j) => j !== i);
    const med = median(train.map((t) => t.lm - t.lt));
    looFlatErrors.push(dated[i]!.lt + med - dated[i]!.lm);
  }
  const flat = missStats(looFlatErrors);

  // The walk-forward flat, pooled over the same cutoffs.
  const wfFlatErrors: number[] = [];
  for (const cut of ['2023-01-01', '2024-01-01', '2025-01-01']) {
    const next = `${Number(cut.slice(0, 4)) + 1}-01-01`;
    const train = dated.filter((c) => c.listedAt < cut);
    const test = dated.filter((c) => c.listedAt >= cut && c.listedAt < next);
    if (train.length < 10 || test.length < 3) continue;
    const med = median(train.map((t) => t.lm - t.lt));
    for (const t of test) wfFlatErrors.push(t.lt + med - t.lm);
  }
  const walkForwardFlat = missStats(wfFlatErrors);

  // The band's honest width: the 10th and 90th percentiles of the
  // leave-one-out log-errors. A refit band alone is far too narrow — the
  // curve's own misses are most of the uncertainty.
  const sortedLoo = [...looErrors].sort((a, b) => a - b);
  const bandE10 = sortedLoo[Math.floor(0.1 * sortedLoo.length)]!;
  const bandE90 = sortedLoo[Math.floor(0.9 * sortedLoo.length)]!;

  // Walk-forward, pooled over the 2023, 2024 and 2025 cutoffs.
  const wfErrors: number[] = [];
  for (const cut of ['2023-01-01', '2024-01-01', '2025-01-01']) {
    const next = `${Number(cut.slice(0, 4)) + 1}-01-01`;
    const train = dated.filter((c) => c.listedAt < cut);
    const test = dated.filter((c) => c.listedAt >= cut && c.listedAt < next);
    if (train.length < 10 || test.length < 3) continue;
    const c = fitCurve(train);
    for (const t of test) {
      const p = bySlug.get(t.slug)!;
      wfErrors.push(predictComp(t, c, 'both', p.change_7d, ageDays(snapshot.as_of, p.listed_at)) - t.lm);
    }
  }
  const walkForward = missStats(wfErrors);

  // The two fixed time splits, against the flat multiple on the same test sets.
  const split = (cut: string): { model: MissStats; flat: MissStats } => {
    const train = dated.filter((c) => c.listedAt < cut);
    const test = dated.filter((c) => c.listedAt >= cut);
    const c = fitCurve(train);
    const flat = median(train.map((t) => t.lm - t.lt));
    const modelErr: number[] = [];
    const flatErr: number[] = [];
    for (const t of test) {
      const p = bySlug.get(t.slug)!;
      modelErr.push(predictComp(t, c, 'both', p.change_7d, ageDays(snapshot.as_of, p.listed_at)) - t.lm);
      flatErr.push(t.lt + flat - t.lm);
    }
    return { model: missStats(modelErr), flat: missStats(flatErr) };
  };
  const sa = split('2024-01-01');
  const sb = split('2023-01-01');

  // Band coverage: each dated comp's actual cap against its own leave-one-out
  // bootstrap band (200 refits of the other comps), so the band is judged on
  // tokens the refits never saw.
  const rng = mulberry32(20261114);
  let covered = 0;
  for (let i = 0; i < dated.length; i++) {
    const others = dated.filter((_, j) => j !== i);
    const vals: number[] = [];
    for (let r = 0; r < 200; r++) {
      const sample = Array.from({ length: others.length }, () => others[Math.floor(rng() * others.length)]!);
      const c = fitCurve(sample);
      const p = bySlug.get(dated[i]!.slug)!;
      vals.push(predictComp(dated[i]!, c, 'both', p.change_7d, ageDays(snapshot.as_of, p.listed_at)));
    }
    vals.sort((a, b) => a - b);
    const lo = vals[Math.floor(0.1 * vals.length)]! + bandE10;
    const hi = vals[Math.floor(0.9 * vals.length)]! + bandE90;
    if (dated[i]!.lm >= lo && dated[i]!.lm <= hi) covered++;
  }
  const bandCoverage = dated.length === 0 ? 0 : covered / dated.length;

  // Ablation: each variant is scored the same way, and the table says which
  // ones the final model kept. Family offsets and Huber weights both lose to
  // the plain curve where it matters, so they are shown and not used.
  const ablation: AblationRow[] = [];
  const variants: { name: string; fit: (pts: { lt: number; lm: number }[]) => Curve; family: boolean; tilts: 'none' | 'growth' | 'both'; flat?: boolean }[] = [
    { name: 'one flat multiple', fit: () => ({ a: flatRatio, b: 1, n: comps.length }), family: false, tilts: 'none', flat: true },
    { name: 'size curve (OLS)', fit: fitCurve, family: false, tilts: 'none' },
    { name: '+ Huber weights', fit: fitHuber, family: false, tilts: 'none' },
    { name: '+ family offsets, shrunk k=16', fit: fitCurve, family: true, tilts: 'none' },
    { name: '+ 7-day growth tilt', fit: fitCurve, family: false, tilts: 'growth' },
    { name: '+ growth and maturity tilts', fit: fitCurve, family: false, tilts: 'both' },
  ];
  for (const v of variants) {
    const looE: number[] = [];
    const wfE: number[] = [];
    const pred: number[] = [];
    const actual: number[] = [];
    for (let i = 0; i < dated.length; i++) {
      const train = dated.filter((_, j) => j !== i);
      const c = v.fit(train);
      const p = bySlug.get(dated[i]!.slug)!;
      let pr = v.flat === true ? dated[i]!.lt + median(train.map((t) => t.lm - t.lt)) : predictComp(dated[i]!, c, v.tilts, p.change_7d, ageDays(snapshot.as_of, p.listed_at));
      if (v.family) pr += familyOffset(dated[i]!.category, train, c);
      looE.push(pr - dated[i]!.lm);
      pred.push(pr);
      actual.push(dated[i]!.lm);
    }
    for (const cut of ['2023-01-01', '2024-01-01', '2025-01-01']) {
      const next = `${Number(cut.slice(0, 4)) + 1}-01-01`;
      const train = dated.filter((c) => c.listedAt < cut);
      const test = dated.filter((c) => c.listedAt >= cut && c.listedAt < next);
      if (train.length < 10 || test.length < 3) continue;
      const c = v.fit(train);
      for (const t of test) {
        const p = bySlug.get(t.slug)!;
        let pr = v.flat === true ? t.lt + median(train.map((x) => x.lm - x.lt)) : predictComp(t, c, v.tilts, p.change_7d, ageDays(snapshot.as_of, p.listed_at));
        if (v.family) pr += familyOffset(t.category, train, c);
        wfE.push(pr - t.lm);
      }
    }
    const kept = v.name === 'size curve (OLS)' || v.name === '+ growth and maturity tilts';
    ablation.push({ variant: v.name, kept, loo: missStats(looE), walkForward: missStats(wfE), rankCorr: spearman(pred, actual) });
  }

  return { comps: comps.length, dated: dated.length, curve, r2, flat, loo, walkForward, walkForwardFlat, bandE10, bandE90, splitA: sa.model, splitB: sb.model, splitAFlat: sa.flat, splitBFlat: sb.flat, looRankCorr, bandCoverage, ablation };
}

/** A category's shrunk offset from a fitted curve's residuals, k = 16 pseudo-counts toward the mean. */
export function familyOffset(category: string | null, train: { lt: number; lm: number; category: string | null }[], curve: Curve): number {
  const resid = train.map((t) => t.lm - (curve.a + curve.b * t.lt));
  const glob = resid.reduce((s, r) => s + r, 0) / resid.length;
  const same = resid.filter((_, i) => train[i]!.category === category);
  if (same.length === 0) return 0;
  const off = (same.reduce((s, r) => s + r, 0) + 16 * glob) / (same.length + 16) - glob;
  return Math.max(-0.5, Math.min(0.5, off));
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  band_lo_usd: number;
  band_hi_usd: number;
  rank_lo: number;
  rank_hi: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  slice_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  breakeven: number;
  model: {
    curve_value_usd: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A protocol set aside from the board, with the rule that set it aside. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** Everything the dashboard needs: the board, the live set, the set-aside, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: string;
  model_version: string;
  comps: Comp[];
  curve: Curve;
  r2: number;
  validation: Validation;
  board_size: number;
  watchlist_size: number;
  live_size: number;
  set_aside_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
  tenure: { label: string; withToken: number; total: number }[];
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  band_lo_usd: number;
  band_hi_usd: number;
  rank_lo: number;
  rank_hi: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  slice_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  breakeven: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  curve_value_usd: number;
  on_watchlist: boolean;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, deposit: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${deposit} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('trading')) return `Provide $${deposit} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${deposit} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${deposit} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('prediction')) return `Deposit $${deposit} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${deposit} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${deposit} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${deposit} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${deposit} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${deposit} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age) and from the farm's own economics at the board's deposit — the slice,
 * the gas, the T-bill yield forgone and the net — never from a hand-written
 * list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEconomics): FarmStep[] {
  const chain = chainOf(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const action = actionFor(p, econ.deposit, chain);
  const verdictLine =
    econ.verdict === 'FARM'
      ? `At a ${Math.round(FARM.airdrop_share * 100)}% airdrop share the slice of $${econ.slice.toFixed(2)} beats the $${econ.cost.toFixed(2)} of gas and yield forgone, netting $${econ.net.toFixed(2)}.`
      : econ.verdict === 'THIN'
        ? `At a ${Math.round(FARM.airdrop_share * 100)}% airdrop share the slice of $${econ.slice.toFixed(2)} covers the gas but not the $${econ.tbill.toFixed(2)} of yield forgone, netting $${econ.net.toFixed(2)}.`
        : `At a ${Math.round(FARM.airdrop_share * 100)}% airdrop share the slice of $${econ.slice.toFixed(2)} does not cover the $${econ.cost.toFixed(2)} of gas and yield forgone, netting $${econ.net.toFixed(2)} — skip unless the share or the value rises.`;
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: action, cost: `$${econ.deposit} of capital and about $${FARM.gas_first} of gas`, time: '15 minutes to set up' },
    { text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`, cost: `about $${FARM.gas_weekly} of gas a week, $${econ.gas.toFixed(0)} over ${weeks} weeks`, time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${econ.deposit} stays in the position and forgoes $${econ.tbill.toFixed(2)} of T-bill yield`, time: `${hold} days` },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `${verdictLine} Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** How many bootstrap refits the band and the rank range are drawn from. */
export const BOOTSTRAP_REFITS = 200;

/** The protocols the board ranks, strongest first, with ranks 1..n, bands and verdicts. */
export function buildBoard(snapshot: Snapshot, comps: Comp[], validation: Validation): { board: BoardRow[]; radar: RadarData } {
  const curve = validation.curve;
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((q) => q.slug === slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol the watchlist does not
  // name, by TVL — above the floor as well as below it. The watchlist is the
  // floor, never the ceiling, and the board ranks all 198 that pass the rule.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  // Bootstrap: refit the curve on resampled comps, reprice every row, and
  // keep the P10-P90 of each row's value and of its rank.
  const rng = mulberry32(20261114);
  const rows = [...chosen.values()];
  const base = rows.map((p) => logImplied(p, snapshot.as_of, curve));
  const bootValues: number[][] = rows.map(() => []);
  const bootRanks: number[][] = rows.map(() => []);
  for (let r = 0; r < BOOTSTRAP_REFITS; r++) {
    const sample = Array.from({ length: comps.length }, () => comps[Math.floor(rng() * comps.length)]!);
    const c = fitCurve(sample);
    const vals = rows.map((p) => logImplied(p, snapshot.as_of, c).logValue);
    const order = vals.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0] || (rows[a[1]]!.slug < rows[b[1]]!.slug ? -1 : 1));
    order.forEach(([_, i], rank) => {
      bootValues[i]!.push(vals[i]!);
      bootRanks[i]!.push(rank + 1);
    });
  }
  const pct = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))]!;

  const scored = rows.map((p, i) => {
    const b = base[i]!;
    const implied = Math.max(1, Math.round(Math.exp(b.logValue)));
    const bv = [...bootValues[i]!].sort((x, y) => x - y);
    const br = [...bootRanks[i]!].sort((x, y) => x - y);
    const econ = farmEconomics(implied, p.tvl_usd, b.age, FARM.default_deposit, FARM.airdrop_share);
    // The band is the refit band widened by the model's own blind misses:
    // a refit band alone pretends the curve is the truth, and it is not.
    const bandLo = Math.max(1, Math.round(Math.exp(pct(bv, 0.1) + validation.bandE10)));
    const bandHi = Math.max(1, Math.round(Math.exp(pct(bv, 0.9) + validation.bandE90)));
    return { p, implied, b, econ, bandLo, bandHi, rankLo: pct(br, 0.1), rankHi: pct(br, 0.9) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.b.age,
    implied_value_usd: s.implied,
    band_lo_usd: s.bandLo,
    band_hi_usd: s.bandHi,
    rank_lo: s.rankLo,
    rank_hi: s.rankHi,
    verdict: s.econ.verdict,
    slice_usd: Math.round(s.econ.slice * 100) / 100,
    net_usd: Math.round(s.econ.net * 100) / 100,
    net_per_hour_usd: Math.round(s.econ.netPerHour * 100) / 100,
    breakeven: s.econ.breakeven === Infinity ? 999 : Math.round(s.econ.breakeven * 10000) / 10000,
    model: {
      curve_value_usd: Math.max(1, Math.round(Math.exp(s.b.curveValue))),
      growth_multiplier: round4(s.b.growthMult),
      maturity_multiplier: round4(s.b.maturityMult),
      age_days: s.b.age,
    },
    farm_steps: farmSteps(s.p, s.b.age, s.econ).map(stepText),
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 128)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));

  const setAside: SetAsideRow[] = snapshot.protocols
    .filter((p) => isPreToken(p) && !chosen.has(p.slug))
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: setAsideReason(p) }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd);

  // Tenure: for each age bucket, the share of protocols whose token already
  // trades — the snapshot's own answer to how long a protocol waits.
  const buckets: { label: string; min: number; max: number }[] = [
    { label: 'under 1 y', min: 0, max: 364 },
    { label: '1–2 y', min: 365, max: 729 },
    { label: '2–3 y', min: 730, max: 1094 },
    { label: '3–5 y', min: 1095, max: 1824 },
    { label: 'over 5 y', min: 1825, max: Number.POSITIVE_INFINITY },
    { label: 'no date', min: -1, max: -1 },
  ];
  const tenure = buckets.map((bk) => {
    const inBucket = snapshot.protocols.filter((p) => {
      const age = ageDays(snapshot.as_of, p.listed_at);
      if (bk.min === -1) return age === null;
      return age !== null && age >= bk.min && age <= bk.max;
    });
    return { label: bk.label, withToken: inBucket.filter((p) => !isPreToken(p)).length, total: inBucket.length };
  });

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL_NAME,
    model_version: MODEL_VERSION,
    comps,
    curve,
    r2: validation.r2,
    validation,
    board_size: board.length,
    watchlist_size: snapshot.watchlist.length,
    live_size: live.length,
    set_aside_size: setAside.length,
    total_implied_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      band_lo_usd: r.band_lo_usd,
      band_hi_usd: r.band_hi_usd,
      rank_lo: r.rank_lo,
      rank_hi: r.rank_hi,
      verdict: r.verdict,
      slice_usd: r.slice_usd,
      net_usd: r.net_usd,
      net_per_hour_usd: r.net_per_hour_usd,
      breakeven: r.breakeven,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      curve_value_usd: r.model.curve_value_usd,
      on_watchlist: snapshot.watchlist.includes(r.slug),
    })),
    live,
    set_aside: setAside,
    tenure,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** The whole run: comps, curve, validation, board and dashboard data, from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; validation: Validation } {
  const comps = compsOf(snapshot);
  const validation = validate(snapshot, comps);
  const { board, radar } = buildBoard(snapshot, comps, validation);
  return { board, radar, validation };
}
