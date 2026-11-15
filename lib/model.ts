// Token Radar's model: one sealed snapshot in, one ranked board out.
//
// The idea, in one paragraph. A protocol that records no token has no market price, so the
// radar prices it the way an analyst would: from the protocols in its own category whose
// tokens already trade. For each category we take the tokenized protocols' market-cap-to-TVL
// ratios, clip them to a sane band so one mania cannot set the price of a whole category,
// and take the median. A category with few trading peers is shrunk toward the global median
// in proportion to how few peers it has; a category with none uses the global median. That
// peer multiple is the base. Two stated adjustments follow: a growth factor from the
// protocol's own seven-day TVL change (clipped hard, because one mercenary deposit can
// fake a trend), and a tenure factor that rises with the days the protocol has run with no
// token and saturates, because a launch is worth more from a protocol with a record. No
// protocol's name is ever special-cased: one function scores every row, and the dashboard
// prints the constants and each row's arithmetic.
//
//   peerMult   = shrunk median of clip(mcap/tvl, 0.02, 5) over the category's tokenized peers
//   base       = tvl_usd x peerMult
//   growthMult = 1 + clamp(change_7d, -50, 100) / 100 x 0.35   (no change reported: 1)
//   tenureMult = 0.75 + 0.25 x (1 - exp(-age_days / 540))      (age unknown: 365 days)
//   implied    = max(1, round(base x growthMult x tenureMult))
//
// The board is every watchlist slug (the floor) plus every other rankable pre-token
// protocol in the snapshot, ranked by implied value. Protocols whose tokens already trade
// are never ranked: they are the peer evidence, and the dashboard shows them apart, at the
// market's own values.

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

/** The model's constants, printed on the dashboard so any reader can re-run the arithmetic. */
export interface ModelConstants {
  multiple_floor: number;
  multiple_cap: number;
  shrink_k: number;
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  tenure_floor: number;
  tenure_range: number;
  tenure_tau_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: 0.02,
  multiple_cap: 5,
  shrink_k: 3,
  growth_weight: 0.35,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  tenure_floor: 0.75,
  tenure_range: 0.25,
  tenure_tau_days: 540,
  unknown_age_days: 365,
};

/** The model's version label, named on the dashboard. */
export const MODEL_VERSION = 'peer-multiple-2';

/** How many live-token protocols the dashboard's already-trading view carries, by market cap. */
export const LIVE_ROWS = 30;

/** One category's peer evidence: the multiple used, how many peers, and where it came from. */
export interface PeerInfo {
  category: string;
  multiple: number;
  peer_count: number;
  basis: 'category' | 'shrunk' | 'global';
  peers: { name: string; symbol: string | null; multiple: number }[];
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
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_basis: 'category' | 'shrunk' | 'global';
    growth_pct: number | null;
    growth_multiplier: number;
    tenure_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row, farm plan included so page and board agree. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  peer_basis: 'category' | 'shrunk' | 'global';
  growth_multiplier: number;
  tenure_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so it is shown at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  categories: PeerInfo[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker shape: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking: a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The exchange names the house's own watchlist rule screens out as name prefixes. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol is one the board may rank: it records no token, and it is not a
 * wrapped, staked or bridged product of a token that already trades, not an exchange and
 * not a versioned pool — the same screens the snapshot's own watchlist rule publishes,
 * applied here to the protocols below the watchlist floor.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    p.category !== 'CEX' &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))
  );
}

/**
 * The peer evidence for every category, plus the global fallback. A peer is a tokenized
 * protocol with a real market cap and TVL; its multiple is clipped before any median is
 * taken, so a single runaway token cannot price a whole category.
 */
export function peerTable(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, PeerInfo>; globalMultiple: number } {
  const usable = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const globalMultiple = median(usable.map((p) => clamp(p.mcap_usd! / p.tvl_usd, model.multiple_floor, model.multiple_cap)));
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of usable) {
    const key = p.category ?? '(uncategorized)';
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const byCategory = new Map<string, PeerInfo>();
  for (const [category, peers] of groups) {
    const multiples = peers.map((p) => clamp(p.mcap_usd! / p.tvl_usd, model.multiple_floor, model.multiple_cap));
    const med = median(multiples);
    const n = peers.length;
    // Thin peer sets borrow strength from the global median in proportion to their thinness.
    const multiple = n >= 8 ? med : (n * med + model.shrink_k * globalMultiple) / (n + model.shrink_k);
    const named = [...peers]
      .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
      .slice(0, 3)
      .map((p) => ({ name: p.name, symbol: p.symbol, multiple: round4(clamp(p.mcap_usd! / p.tvl_usd, model.multiple_floor, model.multiple_cap)) }));
    byCategory.set(category, {
      category,
      multiple: round4(multiple),
      peer_count: n,
      basis: n >= 8 ? 'category' : 'shrunk',
      peers: named,
    });
  }
  return { byCategory, globalMultiple: round4(globalMultiple) };
}

/** The peer evidence one protocol is priced from: its category's, or the global fallback. */
function peerInfoFor(p: SnapshotProtocol, table: { byCategory: Map<string, PeerInfo>; globalMultiple: number }): PeerInfo {
  const found = table.byCategory.get(p.category ?? '(uncategorized)');
  if (found !== undefined) return found;
  return { category: p.category ?? '(uncategorized)', multiple: table.globalMultiple, peer_count: 0, basis: 'global', peers: [] };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: PeerInfo,
  model: ModelConstants,
): { implied: number; growthPct: number | null; growthMult: number; tenureMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = protocol.change_7d;
  const growthMult = growthPct === null ? 1 : 1 + (clamp(growthPct, model.growth_floor_pct, model.growth_cap_pct) / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const tenureMult = model.tenure_floor + model.tenure_range * (1 - Math.exp(-Math.max(ageForModel, 0) / model.tenure_tau_days));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peers.multiple * growthMult * tenureMult));
  return { implied, growthPct, growthMult, tenureMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, whatever the ranking rules below would say.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The radar's wider sweep: every other rankable pre-token protocol below the floor. Above
  // the floor the house's watchlist rule has already screened the field, and what it left
  // out up there it left out for a reason — a wrapped or staked product of a token that
  // already trades (the rules name WBTC, Binance staked ETH and USDT0) — so the board does
  // not re-admit them through the side door.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && isRankable(p)) chosen.set(p.slug, p);
  }
  const table = peerTable(snapshot, model);
  const scored = [...chosen.values()].map((p) => {
    const peers = peerInfoFor(p, table);
    const v = impliedValue(p, snapshot.as_of, peers, model);
    return { p, peers, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: s.peers.multiple,
      peer_count: s.peers.peer_count,
      peer_basis: s.peers.basis,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      tenure_multiplier: round4(s.tenureMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, for multichain protocols. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** A rough gas budget for one transaction on the protocol's first chain. */
function gasFor(p: SnapshotProtocol): string {
  return chainOf(p) === 'Ethereum' ? '$8–15 of ETH for gas' : '$1–3 of gas';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category family's core farming action, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} (${chain}) and trade one small delta-neutral pair: long the perpetual, short the same size on a second venue, so the position earns volume without directional risk`;
  if (c.includes('dex')) return `Provide $${capital} split evenly between USDC and the chain's main asset in ${name}'s deepest pool on ${chain}, in the tightest fee tier that still trades daily, and stake the LP position in its gauge if one is offered`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateralized')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow against it at no more than 50% loan-to-value and re-supply the borrowed asset once, keeping the health factor above 2.0 at all times`;
  if (c.includes('restak')) return `Restake $${capital} of a liquid staking token through ${name} on ${chain}, pick an operator with a public slashing record, and keep the restaking receipt token in the farm wallet`;
  if (c.includes('liquid staking') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the liquid receipt token; do not loop it into lending until the position is a month old`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC from Ethereum to ${chain === 'Ethereum' ? 'an L2 the bridge serves' : chain} through ${name}, then put the bridged funds to work in one app on the far side so the trip is a use, not a round trip`;
  if (c.includes('rwa')) return `Check ${name}'s eligibility page first: if minting is open to your jurisdiction, mint $${capital} of its yield asset on ${chain}; if it is gated, hold the whitelisted stablecoin it names instead and record that the mint itself was not open to you`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into the largest ${name} vault on ${chain} — the one whose curator publishes its allocation — and keep the vault shares unstaked so withdrawals stay one step away`;
  if (c.includes('basis')) return `Open ${name}'s basis position with $${capital} of USDC on ${chain}: the protocol pairs the spot leg with the short hedge itself, so fund it and leave both legs alone`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and enable auto-compounding if the vault offers it, so the position grows without weekly transactions`;
  if (c.includes('insurance')) return `Buy $${capital} of cover on a large protocol from ${name} on ${chain} and hold the policy to expiry; cover that lapses early rarely counts toward any loyalty tally`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take small positions on its three most liquid markets, sized so no single market holds more than a third of the funds`;
  if (c.includes('stable')) return `Mint $${capital} of ${name}'s stable asset against its cheapest accepted collateral on ${chain}, and hold the minted asset in the farm wallet rather than selling it on`;
  return `Deposit $${capital} of USDC into ${name}'s main product on ${chain} through its own app and keep the position open; use the product the way a real user would, not the smallest qualifying click`;
}

/** The recurring qualifying activity for the category family. */
function weeklyAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('perpetual') || c.includes('derivative')) return `Each week, rebalance the hedge on ${name} back to neutral and add one maker trade near the mark price, so the account shows steady volume rather than one burst`;
  if (c.includes('dex')) return `Each week, make one swap of $25–50 through ${name} on ${chain} and re-centre the LP range if the price has drifted out of it`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateralized')) return `Each week, repay a slice of the borrow on ${name} and draw it again two days later, and re-check the health factor after any 10% move in the collateral asset`;
  if (c.includes('bridge')) return `Each week, bridge one small transfer of $25–50 through ${name} in alternating directions and use a different app on the far side each time`;
  if (c.includes('restak') || c.includes('staking')) return `Each week, claim any staking or restaking rewards ${name} shows and restake them into the same position, and check the operator set for changes`;
  return `Each week, make one genuine qualifying action in ${name} — a deposit top-up of $10–25, a claim, or a vote — so the wallet's history reads as a user's, not a snapshot hunter's`;
}

/** The exit path for the category family, including any unbonding reality. */
function exitAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('restak')) return `To exit ${name}, start the withdrawal queue early: restaking exits can sit in an unbonding queue for 7–21 days, so begin the exit a full month before you need the funds and claim on ${chain} when the queue clears`;
  if (c.includes('liquid staking') || c.includes('staking')) return `To exit ${name}, either sell the receipt token in its deepest pool on ${chain} for a small spread or unstake natively and wait out the chain's unbonding period; price both before choosing`;
  if (c.includes('perpetual') || c.includes('derivative')) return `To exit ${name}, close the perpetual and the hedge in the same hour so neither leg sits unhedged, then withdraw the margin to the farm wallet and log the net funding paid or earned`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateralized')) return `To exit ${name}, repay the borrow in full first, confirm the health factor reads no-debt, then withdraw the supplied USDC from ${chain} in one transaction`;
  if (c.includes('rwa')) return `To exit ${name}, redeem through its own redemption window rather than a secondary pool: redemptions can settle in days, not minutes, so plan the exit before you need the capital`;
  return `To exit ${name}, withdraw the position through its own app on ${chain}, move the funds back to the farm wallet, and keep the transaction hashes with the farm log`;
}

/** A step shaped by the protocol's own seven-day TVL movement. */
function trendStep(p: SnapshotProtocol): string {
  const name = p.name;
  const g = p.change_7d;
  if (g === null) return `${name} reports no seven-day TVL change in the snapshot, so size the position at the small end and let a month of your own weekly checks, not one number, tell you whether its TVL is holding`;
  if (g <= -10) return `${name}'s TVL fell ${Math.abs(g).toFixed(1)}% in the snapshot's seven days: before adding a second dollar, read its own announcements page for an exploit, an exodus or an ended incentive, and farm only if the fall is explained`;
  if (g >= 25) return `${name}'s TVL rose ${g.toFixed(1)}% in the snapshot's seven days: do not chase the spike with size — mercenary deposits leave as fast as they came — so enter at the standard size and let the weekly actions do the work`;
  return `${name}'s TVL moved ${g >= 0 ? 'up' : 'down'} ${Math.abs(g).toFixed(1)}% in the snapshot's seven days, inside the normal band: re-check the figure monthly and halve the position if TVL ever falls 30% from your entry month`;
}

/**
 * A protocol's farm plan: six steps, each an action with what it costs and how long it
 * takes, shaped by the protocol's own record — its category's mechanics, its chains, its
 * TVL tier, its age and its seven-day trend. Nothing here is copied from a list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(p);
  const setup =
    second !== null
      ? `Fund a fresh wallet on ${chain} and keep a small gas balance on ${second} too, since ${p.name} runs across ${p.chains.length} chains; a wallet used for nothing else keeps the farm's history clean`
      : `Fund a fresh wallet on ${chain} with the farm capital plus a gas buffer, and use it for ${p.name} and nothing else, so the position's history is one clean record`;
  return [
    `${setup}. Cost: ${gas} to fund and approve. Time: 10 minutes.`,
    `${coreAction(p, capital, chain)}. Cost: $${capital} of capital plus ${gas}. Time: 15 minutes to set up.`,
    `${weeklyAction(p, chain)}. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the ${p.name} position for at least ${hold} days, so the activity spans more than one activity snapshot; ${p.name} has run ${age === null ? 'for an unrecorded span' : `about ${age} days`} with no token recorded, and short visits are the first thing points programs discount. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `${trendStep(p)}. Cost: nothing but the check. Time: 10 minutes a month.`,
    `${exitAction(p, chain)}. Cost: ${gas} to unwind. Time: 15 minutes, plus any queue the exit names.`,
  ];
}

/** The live-token protocols, by market cap, for the dashboard's already-trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's form for data.js: the same facts and the same farm plan the board carries. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    watchlist: row.watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    peer_basis: row.model.peer_basis,
    growth_multiplier: row.model.growth_multiplier,
    tenure_multiplier: row.model.tenure_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const table = peerTable(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const categories = [...table.byCategory.values()].sort((a, b) => (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: table.globalMultiple,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    categories,
    rows: board.map(radarRow),
    live,
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
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
