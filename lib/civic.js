// National results from civicAPI (https://civicapi.org), free, no key; attribution required when shared.
// One search call returns every federal race on the Nov. 3 ballot; per-race detail calls add the
// test-data flag and call time. Results flagged as test data are never shown as real.
import { readFileSync } from 'node:fs';

const BASE = (process.env.CIVIC_BASE || 'https://civicapi.org/api/v2/').replace(/\/?$/, '/');
const HEADERS = { 'user-agent': 'hcdp-election-night/1.0', accept: 'application/json' };
const SEARCH = 'race/search?startDate=2026-11-03&endDate=2026-11-04&country=US&election_type=General&limit=50000';
const STATEWIDE = 'race/search?startDate=2026-11-03&endDate=2026-11-04&country=US&election_type=Statewide&limit=50000';

export const FORECAST = JSON.parse(readFileSync(new URL('./national-forecast.json', import.meta.url), 'utf8'));

async function getJson(path, ms = 9000) {
  if (process.env.CIVIC_FIXTURE) {
    const fx = JSON.parse(readFileSync(process.env.CIVIC_FIXTURE, 'utf8'));
    if (path.startsWith('race/search')) return path.includes('election_type=Statewide') ? fx.statewide || { races: [] } : fx.search;
    const id = path.match(/race\/(\d+)/)?.[1];
    if (fx.details?.[id]) return fx.details[id];
    throw new Error('no fixture detail');
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(BASE + path, { headers: HEADERS, signal: ac.signal });
    if (!r.ok) throw new Error(`civicAPI answered ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// "IN-05" -> "H:IN-5", "AK-AL" -> "H:AK-1", Senate -> "S:NE"
export function keyOf(r) {
  if (r.type === 'US Senate') return r.province ? 'S:' + r.province : null;
  if (r.type !== 'House of Representatives') return null;
  const m = String(r.district || '').match(/^([A-Z]{2})-(\d+|AL)$/);
  return m ? `H:${m[1]}-${m[2] === 'AL' ? 1 : Number(m[2])}` : null;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const last = (s) => clean(s).replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '').split(' ').pop().toLowerCase();

// Which side a civicAPI candidate counts for. Independents FLIPR puts on the Democratic side (NE, MT) count as D.
function sideOf(c, race) {
  const p = String(c.party || '').toLowerCase();
  if (p.startsWith('democrat')) return 'D';
  if (p.startsWith('republican')) return 'R';
  if (race.ind && last(c.name) === race.ind.toLowerCase()) return 'D';
  return 'O';
}

// Shape one race's results for the page, or null if there's nothing real to show.
export function shape(race, civic, { showTest = false } = {}) {
  if (!civic) return null;
  if (civic.test === true && !showTest) return null;
  if (civic.test == null && !showTest && Date.now() < Date.parse('2026-11-03T23:00:00Z')) return null; // unknown flag before polls close: treat as test
  const cands = (civic.candidates || []).map((c) => ({ name: clean(c.name), party: c.party, votes: Number(c.votes) || 0, winner: !!c.winner, side: sideOf(c, race) }));
  const total = cands.reduce((a, c) => a + c.votes, 0);
  const top = (s) => cands.filter((c) => c.side === s).sort((a, b) => b.votes - a.votes)[0] || null;
  const d = top('D'), r = top('R');
  const pick = (c) => (c ? { name: c.name, votes: c.votes, pct: total ? (c.votes / total) * 100 : 0 } : null);
  const w = cands.find((c) => c.winner);
  return {
    margin: (d && total ? (d.votes / total) * 100 : 0) - (r && total ? (r.votes / total) * 100 : 0),
    pct: Number(civic.percent_reporting) || 0,
    total,
    d: pick(d),
    r: pick(r),
    other: total - (d?.votes || 0) - (r?.votes || 0),
    winner: w ? w.side : null,
    winnerName: w ? w.name : null,
    test: civic.test === true,
    updated: civic.last_updated || null,
    calledAt: civic.called_at || null,
  };
}

// Per-race detail (test flag, call time, poll closing) is fetched again only when that race's numbers change,
// or every 5 minutes, so most checks are a single search call even on election night.
const details = new Map(); // race id -> { at, sig, d }
const DETAIL_MS = 5 * 60_000;
const sigOf = (r) => [r.percent_reporting, ...(r.candidates || []).map((c) => `${c.votes}${c.winner ? '*' : ''}`)].join('|');

async function search(path = SEARCH) {
  try { return await getJson(path, 9000); } catch { return await getJson(path, 9000); } // one retry
}
const merge = (r) => {
  const d = details.get(r.id)?.d;
  return d
    ? { ...r, candidates: d.candidates || r.candidates, percent_reporting: d.percent_reporting ?? r.percent_reporting, seats: r.seats ?? d.seats, test: d.test_data === true ? true : d.test_data === false ? false : null, called_at: d.called_at || null, last_updated: d.last_updated || null, polls_close: d.polls_close || null }
    : { ...r, test: null };
};
// Fetch details for races whose numbers changed (or every 5 minutes), at most `budget` per check.
async function refreshDetails(races, budget = Infinity) {
  const now = Date.now();
  const stale = races.filter((r) => { const c = details.get(r.id); return !c || c.sig !== sigOf(r) || now - c.at > DETAIL_MS; }).slice(0, budget);
  await pool(stale, 12, async (r) => {
    try { details.set(r.id, { at: now, sig: sigOf(r), d: await getJson(`race/${r.id}`, 6000) }); } catch { /* keep the last detail we had */ }
  });
}
let lastChambers = []; // state legislative chambers (seat counts by party), from the same search as the federal races

// Every tracked race's civicAPI record, keyed like keyOf().
export async function loadCivic() {
  const want = new Set([...FORECAST.house.map((x) => 'H:' + x.id), ...FORECAST.senate.map((x) => 'S:' + x.id)]);
  const s = await search();
  lastChambers = (s.races || []).filter((r) => /^(State House|State Senate|State Assembly|Legislature|House of Delegates)$/.test(r.type) && !r.district && Number(r.seats) > 0);
  const map = new Map();
  for (const r of s.races || []) { const k = keyOf(r); if (k && want.has(k) && !map.has(k)) map.set(k, r); }
  await refreshDetails([...map.values()]);
  for (const [k, r] of map) map.set(k, merge(r));
  return { map, missing: [...want].filter((k) => !map.has(k)) };
}

// Governors, statewide ballot measures, and legislative chambers. Detail checks are capped per call so a cold
// start stays quick; anything not yet checked is treated as unconfirmed (hidden) until a later check.
const isMeasure = (r) => { const n = (r.candidates || []).map((c) => String(c.name).trim().toLowerCase()); return n.includes('yes') && n.includes('no'); };
export async function loadExtra() {
  const s = await search(STATEWIDE);
  const gov = new Map();
  for (const r of s.races || []) if (r.type === 'Governor' && r.province && !gov.has(r.province)) gov.set(r.province, r);
  const measures = (s.races || []).filter((r) => !r.district && isMeasure(r));
  const hasVotes = (r) => (r.candidates || []).some((c) => Number(c.votes) > 0);
  await refreshDetails([...gov.values()], 40);
  await refreshDetails(measures.filter(hasVotes), 40);
  await refreshDetails(lastChambers, 40);
  return { gov: new Map([...gov].map(([k, r]) => [k, merge(r)])), measures: measures.map(merge), chambers: lastChambers.map(merge) };
}
