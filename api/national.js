// GET /api/national — the FLIPR forecast for every tracked House and Senate race plus live results from civicAPI.
// Public: no code needed.
// ?test=1 (or NATIONAL_SHOW_TEST=1) shows civicAPI's test data, clearly labeled, to check the page before Nov. 3.
import { FORECAST, loadCivic, loadExtra, shape } from '../lib/civic.js';

let cache = null; // { at, goodAt, map, missing, error }
const FRESH_MS = 45_000;

async function civic() {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache;
  try {
    const { map, missing } = await loadCivic();
    cache = { at: Date.now(), goodAt: Date.now(), map, missing, error: null };
  } catch (err) {
    // Keep the last good results if civicAPI hiccups.
    cache = { at: Date.now(), goodAt: cache?.goodAt || null, map: cache?.map || new Map(), missing: cache?.missing || [], error: String(err.message || err) };
  }
  return cache;
}

// Governors, ballot measures, and legislatures: separate so a problem there never blanks the House and Senate.
let extraCache = null;
async function extra() {
  if (extraCache && Date.now() - extraCache.at < FRESH_MS) return extraCache;
  try { extraCache = { at: Date.now(), ...(await loadExtra()), error: null }; }
  catch (err) { extraCache = { gov: new Map(), measures: [], chambers: [], ...(extraCache || {}), at: Date.now(), error: String(err.message || err) }; }
  return extraCache;
}
const votesOf = (r, name) => Number((r.candidates || []).find((c) => String(c.name).trim().toLowerCase() === name)?.votes) || 0;
const seatsOf = (r, party) => (r.candidates || []).filter((c) => String(c.party || c.name).toLowerCase().startsWith(party)).reduce((a, c) => a + (Number(c.seats) || 0), 0);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=30');

  const url = new URL(req.url, 'http://x');
  const showTest = url.searchParams.get('test') === '1' || process.env.NATIONAL_SHOW_TEST === '1';
  const c = await civic();
  const e = await extra();

  const withRes = (list, prefix, src = c.map) => list.map((x) => { const cv = src.get(prefix + x.id); return { ...x, civicId: cv?.id || null, pollsClose: cv?.polls_close || null, res: shape(x, cv, { showTest }) }; });
  const house = withRes(FORECAST.house, 'H:');
  const senate = withRes(FORECAST.senate, 'S:');
  const governors = withRes(FORECAST.governors || [], '', e.gov);
  const all = [...house, ...senate, ...governors];
  const real = (r) => showTest || r.test === false;
  const measures = e.measures.map((r) => {
    const show = real(r), yes = show ? votesOf(r, 'yes') : 0, no = show ? votesOf(r, 'no') : 0;
    const w = show ? (r.candidates || []).find((x) => x.winner) : null;
    return { id: r.id, state: r.province, name: String(r.election_name || '').replace(/\s+/g, ' ').trim(), pct: show ? Number(r.percent_reporting) || 0 : 0, yes, no, winner: w ? String(w.name).trim() : null, pollsClose: r.polls_close || null };
  }).sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  const legislatures = e.chambers.map((r) => {
    const show = real(r);
    return { id: r.id, state: r.province, name: String(r.election_name || '').replace(/\s+/g, ' ').trim(), seats: Number(r.seats) || 0, d: show ? seatsOf(r, 'democrat') : null, r: show ? seatsOf(r, 'republican') : null, pct: show ? Number(r.percent_reporting) || 0 : 0 };
  }).sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

  return res.status(200).json({
    asOf: FORECAST.asOf,
    control: FORECAST.control,
    senateHoldover: FORECAST.senateHoldover,
    houseNow: FORECAST.houseNow,
    asOfNote: FORECAST.asOfNote || null,
    house,
    senate,
    governors,
    measures,
    legislatures,
    showTest,
    anyResults: all.some((x) => x.res),
    extraSource: { ok: !e.error, error: e.error || null },
    source: { ok: !c.error, error: c.error, checkedAt: new Date(c.goodAt || c.at).toISOString(), stale: !!c.error && (!c.goodAt || Date.now() - c.goodAt > 3 * 60_000), matched: c.map.size, missing: c.missing },
  });
}
