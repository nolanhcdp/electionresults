// POST /api/mcp — a read-only MCP server (Streamable HTTP, stateless, JSON responses) so Claude can answer
// election-night questions from the same live data the site shows. Add the URL as a custom connector in Claude.
// Nothing here is secret: every tool reads data the public pages already show. No writes, no Control access.
import nationalHandler from './national.js';
import resultsHandler from './results.js';
import indianaHandler from './indiana.js';
import countyHandler, { COUNTIES } from './county.js';
import { FORECAST } from '../lib/civic.js';
import { breakdown, timeline } from '../lib/civicapi.js';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const POLLS_CLOSE_IN = Date.parse('2026-11-03T23:00:00Z');

// Run one of the site's own API handlers in-process and return its JSON.
function call(handler, path) {
  return new Promise((resolve, reject) => {
    let code = 200;
    const res = {
      setHeader() { return res; },
      status(c) { code = c; return res; },
      json(b) { code >= 400 ? reject(new Error(b?.error || `HTTP ${code}`)) : resolve(b); return res; },
      end() { resolve(null); return res; },
    };
    Promise.resolve(handler({ url: path, method: 'GET', headers: {} }, res)).catch(reject);
  });
}

const mg = (s) => { const m = String(s || '').match(/^([DR])\+([\d.]+)$/); return m ? (m[1] === 'D' ? 1 : -1) * Number(m[2]) : null; };
const fm = (n) => (n == null || Number.isNaN(n) ? null : n === 0 ? 'Even' : `${n > 0 ? 'D' : 'R'}+${Math.abs(n).toFixed(1)}`);
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const et = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' ET' : null);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const label = (x, kind) => (kind === 'house' ? x.id : `${x.state || x.id} ${kind === 'senate' ? 'Senate' : 'Governor'}`);

async function national(test) {
  const n = await call(nationalHandler, `/api/national${test ? '?test=1' : ''}`);
  const tag = (list, kind) => list.map((x) => ({ ...x, kind }));
  n.all = [...tag(n.house, 'house'), ...tag(n.senate, 'senate'), ...tag(n.governors || [], 'governor')];
  return n;
}

// One race in the compact shape every tool returns.
function row(x) {
  const r = x.res;
  const base = mg(x.m24);
  const out = {
    race: label(x, x.kind),
    chamber: x.kind,
    dem: x.d, rep: x.r,
    held_by: x.held || null,
    rating: x.rating,
    forecast_dem_win_pct: x.p,
    flipr_projected_margin: x.proj || null,
    pres_2024_margin: x.m24 || null,
    polls_close: et(x.pollsClose),
  };
  if (!r) return { ...out, status: 'no votes yet' };
  const margin = r.margin;
  return {
    ...out,
    status: r.winner ? `called for ${r.winner === 'D' ? 'Democrat' : r.winner === 'R' ? 'Republican' : 'other'}` : r.total ? 'counting' : 'no votes yet',
    winner: r.winnerName || null,
    called_at: et(r.calledAt),
    flip: !!(r.winner && x.held && r.winner !== x.held && r.winner !== 'O'),
    pct_counted: r1(r.pct),
    total_votes: r.total,
    dem_votes: r.d?.votes ?? 0, dem_pct: r1(r.d?.pct ?? 0),
    rep_votes: r.r?.votes ?? 0, rep_pct: r1(r.r?.pct ?? 0),
    other_votes: r.other,
    current_margin: r.total ? fm(margin) : null,
    swing_vs_2024: r.total && base != null ? fm(margin - base) : null,
    vs_flipr_projection: r.total && mg(x.proj) != null ? fm(margin - mg(x.proj)) : null,
    test_data: r.test || undefined,
    last_updated: et(r.updated),
  };
}

function tally(n) {
  const won = (list, p) => list.filter((x) => x.res?.winner === p).length;
  const lead = (list, p) => list.filter((x) => x.res && !x.res.winner && x.res.total && (p === 'D' ? x.res.margin > 0 : x.res.margin < 0)).length;
  const S = n.senate, H = n.house;
  const gain = H.filter((x) => x.held === 'R' && x.res?.winner === 'D').length, lost = H.filter((x) => x.held === 'D' && x.res?.winner === 'R').length;
  return {
    senate: {
      note: `${n.senateHoldover.D} D and ${n.senateHoldover.R} R seats are not up this year. 51 for control (VP breaks 50-50 ties: R). Dan Osborn (I, NE) counts on the Democratic side.`,
      dem_seats_so_far: n.senateHoldover.D + won(S, 'D'), rep_seats_so_far: n.senateHoldover.R + won(S, 'R'),
      uncalled: S.filter((x) => !x.res?.winner).length,
      uncalled_dem_leading: lead(S, 'D'), uncalled_rep_leading: lead(S, 'R'),
      flips_called: S.filter((x) => x.res?.winner && x.held && x.res.winner !== x.held).map((x) => label(x, 'senate')),
    },
    house: {
      note: `Tracks ${H.length} competitive House races; every other seat is assumed to stay with its party. Democrats hold ${n.houseNow.D} going in; 218 for control.`,
      dem_projected_seats: n.houseNow.D + gain - lost, dem_gains_called: gain, dem_losses_called: lost,
      tracked_called: H.filter((x) => x.res?.winner).length, tracked_uncalled: H.filter((x) => !x.res?.winner).length,
      uncalled_dem_leading: lead(H, 'D'), uncalled_rep_leading: lead(H, 'R'),
      flips_called: H.filter((x) => x.res?.winner && x.held && x.res.winner !== x.held).map((x) => x.id),
    },
    governors: {
      dem_wins: won(n.governors || [], 'D'), rep_wins: won(n.governors || [], 'R'),
      flips_called: (n.governors || []).filter((x) => x.res?.winner && x.held && x.res.winner !== x.held).map((x) => label(x, 'governor')),
    },
  };
}

function swing(n, { chamber = 'house', min = 25, generic } = {}) {
  const pool = n.all.filter((x) => (chamber === 'all' || x.kind === chamber) && x.res && x.res.total > 0 && x.res.pct >= min && mg(x.m24) != null);
  const rows = pool.map((x) => ({ x, sw: x.res.margin - mg(x.m24), vp: mg(x.proj) != null ? x.res.margin - mg(x.proj) : null }))
    .sort((a, b) => b.sw - a.sw);
  const sws = rows.map((r) => r.sw), vps = rows.filter((r) => r.vp != null).map((r) => r.vp);
  const avg = sws.length ? sws.reduce((a, b) => a + b, 0) / sws.length : null;
  const nat24 = mg(FORECAST.m24National || 'R+1.5');
  const target = generic ? mg(String(generic).toUpperCase().replace(/\s/g, '')) : null;
  const out = {
    chamber, min_pct_counted: min, races_used: rows.length,
    baseline: `Each race's current margin minus its 2024 presidential margin (Trump won the 2024 national popular vote by ${fm(nat24).slice(2)} points).`,
    average_swing: fm(avg), median_swing: fm(median(sws)),
    implied_national_environment: avg == null ? null : fm(nat24 + avg),
    races_swinging_dem: sws.filter((s) => s > 0).length, races_swinging_rep: sws.filter((s) => s < 0).length,
    average_vs_flipr_projection: vps.length ? fm(vps.reduce((a, b) => a + b, 0) / vps.length) : null,
    caveats: [
      'Partial counts are skewed by what has been counted: early and mail votes, Election Day votes, and big-city vs. rural precincts arrive at different times and lean differently by state.',
      'civicAPI does not say which kind of vote is still out, so treat any race under about 75% counted as a hint, not a result.',
      'These are the competitive races, not a random sample of the country; incumbency and candidate quality move individual races.',
      'House baselines are district 2024 presidential margins from the FLIPR tables; Senate and governor baselines are statewide 2024 presidential margins.',
    ],
    races: rows.map(({ x, sw, vp }) => ({ race: label(x, x.kind), pct_counted: r1(x.res.pct), current_margin: fm(x.res.margin), pres_2024_margin: x.m24, swing_vs_2024: fm(sw), vs_flipr_projection: vp == null ? null : fm(vp), called: x.res.winner || null })),
  };
  if (target != null) {
    const needed = target - nat24;
    out.generic_ballot_check = {
      generic_ballot: fm(target),
      swing_that_matches_it: fm(needed),
      actual_average_swing: fm(avg),
      difference: avg == null ? null : `${fm(avg - needed)} relative to a ${fm(target)} environment (positive D means Democrats running ahead of it)`,
    };
  }
  if (!rows.length) out.note = `No ${chamber === 'all' ? '' : chamber + ' '}races have ${min}% or more counted yet${Date.now() < POLLS_CLOSE_IN ? ' (polls have not closed; use include_test_data to try the tool with civicAPI practice numbers)' : ''}.`;
  return out;
}

function findRace(n, q) {
  const s = String(q || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const STATES = Object.fromEntries([...n.senate, ...(n.governors || [])].map((x) => [String(x.state).toLowerCase(), x.id]));
  const m = s.match(/^([a-z]{2})[- ]?(\d{1,2}|al)$/);
  if (m) { const id = `${m[1].toUpperCase()}-${m[2] === 'al' ? 1 : Number(m[2])}`; return n.all.find((x) => x.kind === 'house' && x.id === id); }
  const kind = /gov/.test(s) ? 'governor' : /sen/.test(s) ? 'senate' : null;
  const rest = s.replace(/\b(governor|gov|senate|sen|race|u\.?s\.?)\b/g, '').trim();
  const code = rest.length === 2 ? rest.toUpperCase() : STATES[rest];
  const pool = n.all.filter((x) => x.kind !== 'house' && (!kind || x.kind === kind));
  if (code) return pool.find((x) => x.id === code && x.kind === (kind || 'senate')) || pool.find((x) => x.id === code);
  return n.all.find((x) => [x.d, x.r].some((c) => String(c || '').toLowerCase().includes(rest)));
}

const lastWord = (s) => String(s || '').split(' ').pop().toLowerCase();
const howardRow = (r) => {
  const total = (r.cands || []).reduce((a, c) => a + (Number(c.votes) || 0), 0);
  const cands = [...(r.cands || [])].sort((a, b) => b.votes - a.votes).map((c) => ({ name: c.name, party: c.party || null, votes: Number(c.votes) || 0, pct: total ? r1((c.votes / total) * 100) : 0 }));
  return { office: r.office, group: r.group || r.level || null, seats: r.voteFor || 1, precincts: r.precincts ? `${r.precincts.n ?? r.precincts[0]} of ${r.precincts.of ?? r.precincts[1]}` : undefined, pct_counted: r.pct != null ? r1(r.pct) : undefined, total_votes: total, candidates: cands, source: r.backup ? 'civicAPI backup count' : r.source || undefined, howard_only: r.partial || undefined };
};
const match = (r, q) => !q || [r.office, ...(r.cands || []).map((c) => c.name)].some((s) => String(s || '').toLowerCase().includes(String(q).toLowerCase()));

const TEST_ARG = { include_test_data: { type: 'boolean', description: "Use civicAPI's practice numbers (labeled test data) instead of real results. Only for trying things out before results come in." } };
const TOOLS = [
  {
    name: 'national_snapshot',
    description: 'Big picture for the 2026 midterms: Senate and House seat tallies so far, flips called, governors, the FLIPR (Silver Bulletin) control forecast, a quick national swing estimate, and data freshness. Start here for "how is the night going" questions.',
    inputSchema: { type: 'object', properties: { ...TEST_ARG } },
    run: async (a) => {
      const n = await national(a.include_test_data);
      const sw = swing(n, { chamber: 'house', min: 25 });
      const upcoming = [...new Set(n.all.filter((x) => x.pollsClose && Date.parse(x.pollsClose) > Date.now()).map((x) => x.pollsClose))].sort().slice(0, 3)
        .map((t) => ({ polls_close: et(t), races: n.all.filter((x) => x.pollsClose === t).map((x) => label(x, x.kind)) }));
      return {
        as_of: new Date().toISOString(), data: n.source.stale ? 'STALE: civicAPI has not answered for 3+ minutes' : n.source.ok ? 'fresh' : 'last check failed, using last good data',
        results_checked_at: et(n.source.checkedAt), test_data: n.showTest || undefined, any_results_yet: n.anyResults,
        forecast: { source: `FLIPR, Silver Bulletin (${n.asOf})`, dem_chance_senate_control_pct: n.control.senate, dem_chance_house_control_pct: n.control.house },
        ...tally(n),
        house_swing_estimate: { average_swing_vs_2024: sw.average_swing, implied_national_environment: sw.implied_national_environment, races_used: sw.races_used, note: 'House races with 25%+ counted. Use swing_check for detail and caveats.' },
        next_poll_closings: upcoming,
        attribution: 'Live results: civicAPI (civicapi.org). Forecast: Silver Bulletin FLIPR.',
      };
    },
  },
  {
    name: 'swing_check',
    description: 'Are Democrats over- or under-performing? Compares each counted race\'s current margin to its 2024 presidential margin (and to the FLIPR projected margin for House races), averages it, and converts it to an implied national environment. Pass generic_ballot (e.g. "D+9") to compare against a specific national number.',
    inputSchema: {
      type: 'object',
      properties: {
        chamber: { type: 'string', enum: ['house', 'senate', 'governor', 'all'], description: 'Which races to use. House is the best read on the national environment. Default house.' },
        min_pct_counted: { type: 'number', description: 'Only use races with at least this much of the vote counted. Default 25.' },
        generic_ballot: { type: 'string', description: 'A national margin to test against, like "D+9" or "R+2".' },
        ...TEST_ARG,
      },
    },
    run: async (a) => swing(await national(a.include_test_data), { chamber: a.chamber || 'house', min: a.min_pct_counted ?? 25, generic: a.generic_ballot }),
  },
  {
    name: 'list_races',
    description: 'List tracked national races (competitive House seats, every Senate race, governors) with forecast, live count, margin, swing vs. 2024, and call status. Filter by chamber, status, or state.',
    inputSchema: {
      type: 'object',
      properties: {
        chamber: { type: 'string', enum: ['house', 'senate', 'governor', 'all'], description: 'Default all.' },
        status: { type: 'string', enum: ['all', 'uncalled', 'called', 'close', 'flips', 'counting', 'no_votes'], description: 'close = uncalled with votes and margin under 5 points. flips = called for the party that does not hold the seat. Default all.' },
        state: { type: 'string', description: 'Two-letter state code, e.g. PA.' },
        competitive_only: { type: 'boolean', description: 'Skip Solid-rated Senate and governor races (unless they flipped). Default true.' },
        ...TEST_ARG,
      },
    },
    run: async (a) => {
      const n = await national(a.include_test_data);
      const st = a.state ? String(a.state).toUpperCase() : null;
      const comp = a.competitive_only !== false;
      let list = n.all.filter((x) => (!a.chamber || a.chamber === 'all' || x.kind === a.chamber) && (!st || x.id === st || x.id.startsWith(st + '-')));
      if (comp) list = list.filter((x) => x.kind === 'house' || !/^Solid/.test(x.rating) || (x.res?.winner && x.res.winner !== x.held));
      const f = a.status || 'all';
      list = list.filter((x) => {
        const r = x.res;
        if (f === 'uncalled') return !r?.winner;
        if (f === 'called') return !!r?.winner;
        if (f === 'close') return r && !r.winner && r.total > 0 && Math.abs(r.margin) < 5;
        if (f === 'flips') return r?.winner && x.held && r.winner !== x.held && r.winner !== 'O';
        if (f === 'counting') return r && !r.winner && r.total > 0;
        if (f === 'no_votes') return !r || !r.total;
        return true;
      });
      list.sort((a2, b2) => (a2.res && !a2.res.winner && b2.res && !b2.res.winner ? Math.abs(a2.res.margin) - Math.abs(b2.res.margin) : Math.abs(a2.p - 50) - Math.abs(b2.p - 50)));
      return { count: list.length, test_data: n.showTest || undefined, races: list.map(row) };
    },
  },
  {
    name: 'race_detail',
    description: 'Everything on one national race: forecast, live count, swing, plus county-by-county results and how the count moved over the night. Name it like "PA-7", "NC Senate", "Georgia governor", or a candidate\'s last name.',
    inputSchema: { type: 'object', required: ['race'], properties: { race: { type: 'string' }, include_counties: { type: 'boolean', description: 'Default true.' }, ...TEST_ARG } },
    run: async (a) => {
      const n = await national(a.include_test_data);
      const x = findRace(n, a.race);
      if (!x) throw new Error(`No tracked race matches "${a.race}". Only competitive House seats are tracked; try list_races.`);
      const out = { ...row(x), note: x.note || undefined };
      if (x.civicId && a.include_counties !== false) {
        try {
          const b = await breakdown(x.civicId, { testdata: !!a.include_test_data });
          out.counties = b.counties.map((c) => {
            const t = c.cands.reduce((s, k) => s + k.votes, 0);
            const d = c.cands.filter((k) => k.party === 'D' || (x.ind && lastWord(k.name) === x.ind.toLowerCase())).reduce((s, k) => s + k.votes, 0);
            const r = c.cands.filter((k) => k.party === 'R').reduce((s, k) => s + k.votes, 0);
            return { county: c.name, pct_counted: r1(c.pct), total_votes: t, margin: t ? fm(((d - r) / t) * 100) : null };
          });
        } catch (e) { out.counties_error = String(e.message || e); }
        try {
          const t = await timeline(x.civicId, { points: 10 });
          out.over_the_night = t.points.map((p) => {
            const tot = p.cands.reduce((s, k) => s + k.votes, 0);
            const d = p.cands.filter((k) => k.party === 'D' || (x.ind && lastWord(k.name) === x.ind.toLowerCase())).reduce((s, k) => s + k.votes, 0);
            const r = p.cands.filter((k) => k.party === 'R').reduce((s, k) => s + k.votes, 0);
            return { time: et(p.t), pct_counted: r1(p.pct), total_votes: tot, margin: tot ? fm(((d - r) / tot) * 100) : null };
          });
        } catch { /* no history yet */ }
      }
      return out;
    },
  },
  {
    name: 'ballot_measures_and_legislatures',
    description: 'Statewide ballot measures (yes/no counts, % counted, result) and state legislative chamber seat totals, nationwide. Optionally filter by state.',
    inputSchema: { type: 'object', properties: { state: { type: 'string', description: 'Two-letter state code.' }, ...TEST_ARG } },
    run: async (a) => {
      const n = await national(a.include_test_data);
      const st = a.state ? String(a.state).toUpperCase() : null;
      const keep = (x) => !st || x.state === st;
      return {
        measures: n.measures.filter(keep).map((m) => ({ state: m.state, measure: m.name, pct_counted: r1(m.pct), yes: m.yes, no: m.no, yes_pct: m.yes + m.no ? r1((m.yes / (m.yes + m.no)) * 100) : null, result: m.winner })),
        legislatures: n.legislatures.filter(keep).map((l) => ({ state: l.state, chamber: l.name, seats_up: l.seats, dem_won: l.d, rep_won: l.r, pct_counted: r1(l.pct) })),
      };
    },
  },
  {
    name: 'howard_county_results',
    description: 'Howard County, Indiana results (the HCDP board): county, township, town, school board, and judicial races from the county clerk, plus the congressional, legislative, and statewide races Howard County votes in. Includes precincts reporting, ballots cast, and registered voters.',
    inputSchema: { type: 'object', properties: { search: { type: 'string', description: 'Filter by office or candidate name, e.g. "council" or "Colon".' } } },
    run: async (a) => {
      const b = await call(resultsHandler, '/api/results');
      const races = b.races.filter((r) => match(r, a.search)).map(howardRow);
      return {
        report: b.meta, before_results: b.beforeResults || undefined,
        turnout_pct: b.meta?.ballotsCast && b.meta?.registered ? r1((b.meta.ballotsCast / b.meta.registered) * 100) : null,
        sources: { clerk: b.sources.clerk.ok ? `ok${b.sources.clerk.general ? '' : ' (still showing the primary page)'}` : `down: ${b.sources.clerk.error}`, state: b.sources.state.live ? 'live' : 'not posting the general yet', civic_backup_races: b.sources.civic.used, clerk_vs_civic_disagreements: b.sources.civic.disagree },
        races,
      };
    },
  },
  {
    name: 'indiana_results',
    description: 'Every contested Indiana race statewide: statewide offices, U.S. House, State Senate, State House, and statewide ballot questions, from the Indiana Secretary of State results site.',
    inputSchema: { type: 'object', properties: { group: { type: 'string', enum: ['Statewide', 'Congress', 'State Senate', 'State House', 'Ballot questions'] }, search: { type: 'string', description: 'Office, district (e.g. "HD30"), or candidate.' } } },
    run: async (a) => {
      const b = await call(indianaHandler, '/api/indiana');
      const races = b.races.filter((r) => (!a.group || r.group === a.group) && (match(r, a.search) || (a.search && String(r.seat).toLowerCase() === String(a.search).toLowerCase()))).map((r) => ({ seat: r.seat, ...howardRow(r) }));
      return { state_site_live: b.live, election: b.election, count: races.length, races };
    },
  },
  {
    name: 'indiana_county_results',
    description: 'Contested local races in any Indiana county (county offices, courts, cities and towns, townships, school boards, questions), from civicAPI.',
    inputSchema: { type: 'object', required: ['county'], properties: { county: { type: 'string', description: 'County name, e.g. "Tipton".' }, search: { type: 'string' }, ...TEST_ARG } },
    run: async (a) => {
      const c = COUNTIES.find((x) => x.toLowerCase() === String(a.county || '').replace(/\s+county$/i, '').trim().toLowerCase());
      if (!c) throw new Error(`"${a.county}" isn't an Indiana county.`);
      const b = await call(countyHandler, `/api/county?c=${encodeURIComponent(c)}${a.include_test_data ? '&test=1' : ''}`);
      const races = b.races.filter((r) => match(r, a.search)).map((r) => ({ ...howardRow(r), group: r.group, live: r.live }));
      return { county: c, test_data: b.test || undefined, any_live: b.live, count: races.length, races };
    },
  },
];

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid request');
  const { id, method, params = {} } = msg;
  const note = id === undefined || id === null;
  if (method === 'initialize') {
    const v = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0];
    return ok(id, {
      protocolVersion: v,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'hcdp-election-night', title: 'HCDP Election Night', version: '1.0.0' },
      instructions: 'Live 2026 general election results (Nov. 3, 2026). National: competitive House seats, all Senate races, governors, ballot measures (civicAPI live counts + Silver Bulletin FLIPR forecast). Indiana: Howard County clerk, Indiana Secretary of State, and every county via civicAPI. Margins are written D+n / R+n. Before polls close there are no real numbers; include_test_data shows labeled practice data. Always mention how much of the vote is counted when quoting a margin.',
    });
  }
  if (note) return null; // notifications/initialized and friends
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: TOOLS.map(({ run, ...t }) => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: false } })) });
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
    try {
      const out = await tool.run(params.arguments || {});
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(out) }] });
    } catch (e) {
      return ok(id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true });
    }
  }
  if (method === 'resources/list') return ok(id, { resources: [] });
  if (method === 'prompts/list') return ok(id, { prompts: [] });
  return fail(id, -32601, `Method not found: ${method}`);
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') return typeof req.body === 'string' ? JSON.parse(req.body) : Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, accept, mcp-protocol-version, mcp-session-id, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(fail(null, -32000, 'This MCP server takes POST requests. Add https://<your site>/api/mcp as a custom connector in Claude.'));
  }
  let body;
  try { body = await readBody(req); } catch { return res.status(400).json(fail(null, -32700, 'Parse error')); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? res.status(200).json(out) : res.status(202).end();
  }
  const out = await handle(body);
  return out ? res.status(200).json(out) : res.status(202).end();
}
