// Shared civicAPI helpers for the Howard board, "Around Indiana", county breakdowns, and vote timelines.
// civicAPI (https://civicapi.org) is free with no key; attribution required. Its numbers are a backup and an
// extra: the clerk stays first for Howard County races and the Secretary of State first for district races.
const BASE = (process.env.CIVIC_BASE || 'https://civicapi.org/api/v2/').replace(/\/?$/, '/');
const HEADERS = { 'user-agent': 'hcdp-election-night/1.0', accept: 'application/json' };
const DATES = 'startDate=2026-11-03&endDate=2026-11-04';
// Indiana's polls close at 6 p.m. local; civicAPI numbers aren't trusted before then (they run test data this week).
const POLLS_CLOSE = Date.parse(process.env.CIVIC_TRUST_AFTER || '2026-11-03T23:00:00Z');

const cache = new Map(); // path -> { at, ttl, value }
export async function civicGet(path, { ttl = 30_000, timeout = 9000, raw = false } = {}) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(BASE + path, { headers: HEADERS, signal: ac.signal });
    if (!r.ok) throw new Error(`civicAPI answered ${r.status}`);
    const value = raw ? await r.text() : await r.json();
    cache.set(path, { at: Date.now(), ttl, value });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return value;
  } catch (err) {
    if (hit) return hit.value; // stale beats nothing
    throw err;
  } finally { clearTimeout(t); }
}

export const searchCounty = (county) => civicGet(`race/search?${DATES}&country=US&province=IN&district=${encodeURIComponent(county)}&limit=500`, { ttl: 30_000 });
export const searchIndiana = () => civicGet(`race/search?${DATES}&country=US&province=IN&limit=50000`, { ttl: 60_000, timeout: 15000 });
export const detail = (id, ttl = 30_000) => civicGet(`race/${id}`, { ttl });

// Real results only: polls closed in Indiana and civicAPI says the race isn't test data.
export const trustNow = () => Date.now() >= POLLS_CLOSE;
const hasVotes = (r) => (r.candidates || []).some((c) => Number(c.votes) > 0);

export const partyCode = (p) => {
  const s = String(p || '').toLowerCase();
  if (s.startsWith('democrat')) return 'D';
  if (s.startsWith('republican')) return 'R';
  if (s.startsWith('libertarian')) return 'L';
  if (s.startsWith('independent')) return 'I';
  if (!s || s === 'nonpartisan' || s === 'yes' || s === 'no') return '';
  return s.slice(0, 3).toUpperCase();
};
export const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Candidates with live votes, or zero votes when there's nothing real yet. Checks the detail for the test flag.
export async function liveCands(race) {
  const zero = (race.candidates || []).map((c) => ({ name: cleanName(c.name), party: partyCode(c.party), votes: 0 }));
  if (!trustNow() || !hasVotes(race)) return { cands: zero, live: false, pct: 0 };
  let d;
  try { d = await detail(race.id, 60_000); } catch { return { cands: zero, live: false, pct: 0 }; }
  if (d.test_data !== false) return { cands: zero, live: false, pct: 0 };
  const src = d.candidates || race.candidates || [];
  return {
    live: true,
    pct: Number(d.percent_reporting ?? race.percent_reporting) || 0,
    cands: src.map((c) => ({ name: cleanName(c.name), party: partyCode(c.party), votes: Number(c.votes) || 0, winner: !!c.winner })),
    calledAt: d.called_at || null,
  };
}

// One key for the same race no matter who named it: the clerk ("TOWNSHIP BOARD CENTER", "COUNTY COUNCIL DIST 3"),
// the state's candidate list and civicAPI ("Center Township Board Member, Howard County").
const TOWNSHIPS = 'center|clay|ervin|harrison|honey creek|howard|jackson|liberty|monroe|taylor|union';
const TOWNS = 'greentown|russiaville|kokomo';
export function canonKey(title) {
  const s = ' ' + String(title || '').toLowerCase().replace(/[#.,\-_/()]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const num = (s.match(/\b(?:dist|dst|district|no|number)\s*(\d+)\b/) || s.match(/\bcourt\s*(\d+)\b/) || s.match(/\b(\d+)\s*$/) || [])[1];
  let m;
  if ((m = s.match(new RegExp(`\\b(${TOWNSHIPS}) township (board|trustee|assessor)`))) || (m = s.match(new RegExp(`\\btownship (board|trustee|assessor) (${TOWNSHIPS})\\b`)))) {
    const [a, b] = m[1] === 'board' || m[1] === 'trustee' || m[1] === 'assessor' ? [m[2], m[1]] : [m[1], m[2]];
    return `twp:${a}:${b}`;
  }
  const town = (s.match(new RegExp(`\\b(${TOWNS})\\b`)) || [])[1];
  if (/\btown council\b/.test(s) && town) return `town:${town}:council`;
  if (/\bclerk treasurer\b/.test(s) && town) return `town:${town}:clerktreasurer`;
  if (/\bcounty council\b/.test(s)) return /\bat large\b/.test(s) ? 'county:council:at-large' : num ? `county:council:${num}` : null;
  if (/\bcommissioner\b/.test(s)) return num ? `county:commissioner:${num}` : null;
  if (/\bcircuit court clerk\b|\bclerk of the circuit court\b/.test(s)) return 'county:clerk';
  if (/\bjudge\b/.test(s) && /\bsuperior\b/.test(s)) return `judge:superior:${num || ''}`;
  if (/\bjudge\b/.test(s) && /\bcircuit\b/.test(s)) return 'judge:circuit';
  if (/\bprosecut|^ (?:dem |rep )?attorney $/.test(s)) return 'county:prosecutor';
  for (const office of ['recorder', 'sheriff', 'assessor', 'treasurer', 'auditor', 'coroner', 'surveyor']) if (new RegExp(`\\b${office}\\b`).test(s)) return `county:${office}`;
  return null;
}

// civicAPI race for a state seat key used by the board (CD5, SD21, HD30, SOS, TRE, COMP, GOV, AG, USSEN).
export async function seatRace(seat) {
  const { races = [] } = await searchIndiana();
  const m = String(seat).match(/^(CD|SD|HD)(\d+)$/);
  if (m) {
    const code = m[1] === 'CD' ? `IN-${m[2].padStart(2, '0')}` : `IN-${m[1]}-${Number(m[2])}`;
    return races.find((r) => r.district === code && /House of Representatives|State Senate|State House/.test(r.type)) || null;
  }
  const TYPE = { SOS: 'Secretary of State', TRE: 'State Treasurer', COMP: 'State Comptroller', GOV: 'Governor', AG: 'Attorney General', USSEN: 'US Senate' };
  return TYPE[seat] ? races.find((r) => r.type === TYPE[seat] && !r.district) || null : null;
}

// County-by-county results for one race (counties only; no precincts).
export async function breakdown(id, { testdata = false } = {}) {
  const d = await civicGet(`race/${id}${testdata ? '?testdata' : ''}`, { ttl: testdata ? 300_000 : 30_000 });
  const real = testdata || (trustNow() && d.test_data === false);
  const regions = Object.values(d.region_results || {}).filter((r) => !r.type || /county/i.test(r.type));
  return {
    id, name: d.election_name, test: testdata, live: real,
    counties: regions.map((r) => ({
      name: r.name,
      pct: Number(r.percent_reporting) || 0,
      cands: (r.candidates || []).map((c) => ({ name: cleanName(c.name), party: partyCode(c.party), votes: real ? Number(c.votes) || 0 : 0 })),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// A race's vote history over the night: up to `points` snapshots, oldest first.
const snaps = new Map(); // `${id}@${ts}` -> snapshot (they never change)
export async function timeline(id, { points = 16 } = {}) {
  const h = await civicGet(`race/${id}/history`, { ttl: 60_000 });
  const all = (h.timestamps || []).map((t) => (typeof t === 'string' ? t : t.timestamp)).filter(Boolean).sort();
  const pick = all.length <= points ? all : Array.from({ length: points }, (_, i) => all[Math.round((i * (all.length - 1)) / (points - 1))]);
  const out = [];
  for (const ts of [...new Set(pick)]) {
    const key = `${id}@${ts}`;
    if (!snaps.has(key)) {
      try { snaps.set(key, await civicGet(`race/${id}/history/${ts}?light`, { ttl: 3_600_000 })); } catch { continue; }
    }
    const s = snaps.get(key);
    if (s.test_data === true) continue;
    out.push({
      t: ts,
      pct: Number(s.percent_reporting) || 0,
      cands: (s.candidates || []).map((c) => ({ name: cleanName(c.name), party: partyCode(c.party), votes: Number(c.votes) || 0 })),
    });
  }
  return { id, points: out };
}
