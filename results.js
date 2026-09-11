// Election night results board: one self-contained Vercel function.
// GET /api/results  (routed here by vercel.json)
//
//   1. fetch the clerk's Electionware "Summary Results Report" HTML
//   2. parse it (parseReport)
//   3. apply config.json (digest)
//   4. return JSON, cached at the edge for config.pollSeconds
//
// Everything lives in this one file so the project has no subfolders and can be
// uploaded to GitHub through the browser in a single drag.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- parser ----------
// Parser for Electionware "Summary Results Report" HTML exports (JasperReports).
//
// The export is a stack of absolutely-positioned <div>s, one per printed page,
// where every piece of text is a leaf <span style="font-family: Roboto ...">.
// Document order matches reading order, so we pull the spans out in sequence
// and run a small state machine over them. No DOM needed.

const SPAN_RE = /<span style="font-family: Roboto[^"]*">([^<]*)<\/span>/g;

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&#39;': "'", '&apos;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' };

export function extractTokens(html) {
  const out = [];
  let m;
  while ((m = SPAN_RE.exec(html))) {
    const t = m[1].replace(/&[a-z#0-9]+;/g, (e) => ENTITIES[e] ?? e).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

const toInt = (s) => {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const NOISE = new Set(['Summary Results Report', 'TOTAL']);

/**
 * Parse the report into { meta, statistics, contests }.
 * Every contest: { id, title, party, office, voteFor, candidates:[{name, votes}],
 *                  overvotes, undervotes, total }
 */
export function parseReport(html) {
  const tokens = extractTokens(html);
  if (!tokens.length) throw new Error('No Electionware text spans found in document');

  const meta = { report: null, election: null, date: null, status: null, jurisdiction: null, generatedAt: null, pages: null };
  const statistics = {};
  const contests = [];

  // First page header: "Summary Results Report", election name, date, status, jurisdiction.
  const h = tokens.indexOf('Summary Results Report');
  if (h >= 0) {
    meta.report = tokens[h];
    meta.election = tokens[h + 1] ?? null;
    meta.date = tokens[h + 2] ?? null;
    meta.status = tokens[h + 3] ?? null;
    meta.jurisdiction = tokens[h + 4] ?? null;
  }
  const headerSet = new Set([meta.election, meta.date, meta.status, meta.jurisdiction].filter(Boolean));

  let i = 0;
  let mode = 'start'; // start | stats | contest
  let cur = null;

  const isHeaderNoise = (t) => NOISE.has(t) || headerSet.has(t) || /^Report generated with Electionware/.test(t);

  while (i < tokens.length) {
    const t = tokens[i];

    // Page footer: "Election Summary - MM/DD/YYYY  H:MM PM", page number, "of N"
    if (/^Election Summary - /.test(t)) {
      if (!meta.generatedAt) {
        const mm = t.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
        meta.generatedAt = mm ? `${mm[1]} ${mm[2]}` : t.replace(/^Election Summary - /, '');
      }
      const of = tokens[i + 2];
      if (of && /^of \d+$/.test(of)) {
        meta.pages = toInt(of.slice(3));
        i += 3;
      } else i += 1;
      continue;
    }
    if (isHeaderNoise(t)) { i += 1; continue; }

    // Contest start: title followed by "Vote For N"
    const next = tokens[i + 1];
    if (next && /^Vote For \d+$/.test(next)) {
      if (cur) contests.push(cur);
      const mParty = t.match(/^(REP|DEM|LIB|GRN|IND|NP)\s+(.*)$/);
      cur = {
        id: t,
        title: t,
        party: mParty ? mParty[1] : null,
        office: mParty ? mParty[2] : t,
        voteFor: toInt(next.replace('Vote For ', '')),
        candidates: [],
        overvotes: null,
        undervotes: null,
        total: null,
      };
      mode = 'contest';
      i += 2;
      continue;
    }

    if (t === 'Statistics') { mode = 'stats'; i += 1; continue; }

    if (mode === 'stats') {
      const v = tokens[i + 1];
      if (v !== undefined) statistics[t] = toInt(v) ?? v;
      i += 2;
      continue;
    }

    if (mode === 'contest' && cur) {
      const v = tokens[i + 1];
      const n = toInt(v);
      if (n === null) { i += 1; continue; } // stray text, skip
      if (t === 'Overvotes') cur.overvotes = n;
      else if (t === 'Undervotes') cur.undervotes = n;
      else if (t === 'Contest Totals') { cur.total = n; contests.push(cur); cur = null; mode = 'between'; }
      else cur.candidates.push({ name: t, votes: n });
      i += 2;
      continue;
    }

    i += 1;
  }
  if (cur) contests.push(cur);

  return { meta, statistics, contests };
}

// ---------- digest ----------
// Turns a parsed report into exactly what the board should show, driven by config.json.

export function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/(^|[\s(\-'/.])([a-z])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/\bJr\b\.?/g, 'Jr.')
    .replace(/\bIi\b/g, 'II')
    .replace(/\bIii\b/g, 'III')
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase());
}

export function tierOf(office) {
  const o = office.toUpperCase();
  if (/^US |PRESIDENT|U\.S\./.test(o)) return 'federal';
  if (/^STATE (SENATOR|REPRESENTATIVE)|GOVERNOR|SECRETARY OF STATE|TREASURER OF STATE|AUDITOR OF STATE|COMPTROLLER|ATTORNEY GENERAL|SUPERINTENDENT/.test(o)) return 'state';
  if (/PRECINCT COMMITTEE/.test(o)) return 'precinct';
  if (/STATE CONVENTION DELEGATE/.test(o)) return 'delegate';
  if (/TOWNSHIP|TOWN COUNCIL|CLERK-TREASURER|CITY|MAYOR|SCHOOL BOARD/.test(o)) return 'local';
  return 'county';
}

const TIER_LABEL = { federal: 'Federal', state: 'Statehouse', county: 'County', local: 'Township and town', precinct: 'Precinct committee', delegate: 'Convention delegates', other: 'Other' };

function prettyOffice(office) {
  let s = titleCase(office);
  s = s.replace(/\bDist\.? #?(\d+)/i, 'District $1');
  s = s.replace(/\bUs\b/, 'U.S.');
  return s;
}

export function digest(parsed, config = {}) {
  const parties = Array.isArray(config.parties) && config.parties.length ? new Set(config.parties) : null;
  const hidePatterns = (config.hidePatterns || []).map((p) => new RegExp(p, 'i'));
  const overrides = config.contests || {};
  const candNames = config.candidates || {};
  const featured = config.featured || [];
  const hideNoCandidate = config.hideNoCandidate !== false;

  const wanted = parsed.contests.filter((c) => {
    if (overrides[c.id]?.hide) return false;
    if (parties && c.party && !parties.has(c.party)) return false;
    if (hidePatterns.some((re) => re.test(c.id))) return false;
    if (hideNoCandidate && c.candidates.every((k) => /^NO CANDIDATE FILED$/i.test(k.name))) return false;
    if (config.hideUncontested && c.candidates.length <= (c.voteFor || 1)) return false;
    return true;
  });

  const contests = wanted.map((c) => {
    const ov = overrides[c.id] || {};
    const candidateVotes = c.candidates.reduce((a, k) => a + k.votes, 0);
    const winners = c.voteFor || 1;
    const sorted = [...c.candidates].sort((a, b) => b.votes - a.votes);
    const candidates = sorted.map((k, idx) => ({
      id: k.name,
      name: candNames[k.name] || (ov.candidates && ov.candidates[k.name]) || titleCase(k.name),
      votes: k.votes,
      pct: candidateVotes ? k.votes / candidateVotes : 0,
      leading: idx < winners && k.votes > 0,
      ours: ov.ours ? ov.ours.includes(k.name) : undefined,
    }));
    const lead = sorted[0]?.votes ?? 0;
    const runnerUp = sorted[winners]?.votes ?? 0; // first candidate outside the winning slots
    const margin = candidates.length > winners ? { votes: (sorted[winners - 1]?.votes ?? 0) - runnerUp, pct: candidateVotes ? ((sorted[winners - 1]?.votes ?? 0) - runnerUp) / candidateVotes : 0 } : null;
    return {
      id: c.id,
      party: c.party,
      name: ov.name || prettyOffice(c.office),
      note: ov.note || null,
      tier: ov.tier || tierOf(c.office),
      tierLabel: TIER_LABEL[ov.tier || tierOf(c.office)] || 'Other',
      voteFor: winners,
      contested: candidates.length > winners,
      candidateVotes,
      total: c.total,
      undervotes: c.undervotes,
      overvotes: c.overvotes,
      margin,
      benchmark: ov.benchmark || null,
      featured: featured.includes(c.id),
      candidates,
      _lead: lead,
    };
  });

  // Featured contests first, in the order listed in config; everything else keeps report order.
  const rank = (c) => (c.featured ? featured.indexOf(c.id) : 10_000 + parsed.contests.findIndex((p) => p.id === c.id));
  contests.sort((a, b) => rank(a) - rank(b));
  contests.forEach((c) => delete c._lead);

  const stats = parsed.statistics || {};
  return {
    title: config.title || `${parsed.meta.jurisdiction || ''} ${parsed.meta.election || ''}`.trim(),
    subtitle: config.subtitle || null,
    meta: parsed.meta,
    ballotsCast: stats['Ballots Cast - Total'] ?? null,
    registeredVoters: stats['Registered Voters - Total'] ?? null,
    turnout: typeof stats['Voter Turnout - Total'] === 'string' ? stats['Voter Turnout - Total'] : (stats['Voter Turnout - Total'] ?? null),
    statistics: stats,
    contestCount: parsed.contests.length,
    shownCount: contests.length,
    contests,
    pollSeconds: config.pollSeconds || 30,
  };
}

// ---------- handler ----------
const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'config.json'), 'utf8'));

// Keep the last good result in memory so a hiccup at the clerk's server
// (or a half-uploaded file) doesn't blank the board.
let lastGood = null;

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const source = process.env.RESULTS_URL || config.sourceUrl;
  const poll = config.pollSeconds || 30;

  try {
    const r = await fetch(source, { headers: { 'user-agent': 'hcdp-election-board/1.0', 'cache-control': 'no-cache' } , cache: 'no-store' });
    if (!r.ok) throw new Error(`Clerk's server answered ${r.status}`);
    const html = await r.text();
    const parsed = parseReport(html);
    if (!parsed.contests.length) throw new Error('Report parsed but contained no contests');

    const body = digest(parsed, config);
    body.fetchedAt = new Date().toISOString();
    body.source = source;
    body.stale = false;
    lastGood = body;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `public, s-maxage=${poll}, stale-while-revalidate=300`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (url.searchParams.get('raw') === '1') return res.status(200).json({ parsed, config });
    return res.status(200).json(body);
  } catch (err) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (lastGood) {
      return res.status(200).json({ ...lastGood, stale: true, error: String(err.message || err) });
    }
    return res.status(502).json({ error: String(err.message || err), source });
  }
}
