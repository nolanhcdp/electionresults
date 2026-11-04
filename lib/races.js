import config from './config.js';
import { parseReport, clerkRaces, clerkMeta } from './clerk.js';
import { findBySeat, enrSettings } from './enr.js';
import { ballotSeat } from './ballot.js';
import { howardBallotRaces } from './preview.js';
import { searchCounty, liveCands, canonKey, seatRace, seatCount, withNames, trustNow } from './civicapi.js';

// Last good answer from each source, so a hiccup on either site never blanks the board.
const lastGood = { clerk: null, state: new Map() };

async function loadClerk(stateUrl) {
  const url = stateUrl || process.env.CLERK_URL || config.clerkUrl;
  if (lastGood.clerk && lastGood.clerk.url !== url) lastGood.clerk = null; // new page: don't fall back to the old one
  try {
    const r = await fetch(url, { headers: { 'cache-control': 'no-cache', 'user-agent': 'hcdp-election-night/1.0' } });
    if (!r.ok) throw new Error(`Clerk's page answered ${r.status}`);
    const parsed = parseReport(await r.text());
    if (!parsed.contests.length) throw new Error("Clerk's report had no contests");
    lastGood.clerk = { url, parsed, meta: clerkMeta(parsed), at: new Date().toISOString() };
    return { ...lastGood.clerk, ok: true };
  } catch (err) {
    if (lastGood.clerk) return { ...lastGood.clerk, ok: false, error: String(err.message || err) };
    return { url, parsed: null, meta: {}, ok: false, error: String(err.message || err) };
  }
}

const STATEWIDE = /^(SOS|TRE|COMP|GOV|AG|USSEN)$/;
const fixName = (n) => config.candidates?.[String(n).toUpperCase()] || n;

// One seat (e.g. SD21). On election night: the state's whole-district numbers. Before that: who's on the
// November ballot, with no votes.
async function loadSeatRace(spec, enrLive) {
  const base = { id: spec.id, source: 'state', office: spec.name, level: spec.level, seat: spec.seat, scope: STATEWIDE.test(spec.seat) ? 'statewide' : 'district' };
  if (enrLive) {
    try {
      const hit = await findBySeat(config.enrBase, spec.seat);
      if (!hit) return ballotRace(spec, base);
      const race = { ...base, voteFor: hit.seats, cands: hit.cands.map((c) => ({ ...c, name: fixName(c.name) })), stateKey: `${hit.categoryId}:${hit.officeId}` };
      lastGood.state.set(spec.id, race);
      return race;
    } catch (err) {
      const prev = lastGood.state.get(spec.id);
      return prev ? { ...prev, stale: true } : ballotRace(spec, base); // state site down: civicAPI fills it in below
    }
  }
  return ballotRace(spec, base);
}
function ballotRace(spec, base) {
  const b = ballotSeat(spec.seat);
  if (!b) return { missing: true, id: spec.id, seat: spec.seat };
  return { ...base, voteFor: 1, cands: b.cands.map((c) => ({ ...c, name: fixName(c.name), votes: 0 })) };
}

// civicAPI's Howard County races, keyed so they line up with the clerk's and the candidate list's names.
async function civicHoward() {
  try {
    const { races = [] } = await searchCounty('Howard');
    const map = new Map();
    await Promise.all(races.map(async (r) => { const k = canonKey(r.election_name); if (k) map.set(k, { id: r.id, ...(await liveCands(r)) }); }));
    return { ok: true, map };
  } catch (err) {
    return { ok: false, map: new Map(), error: String(err.message || err) };
  }
}
const sum = (cands) => cands.reduce((a, c) => a + (Number(c.votes) || 0), 0);

export async function buildResults(state) {
  // Is the state's site showing this November's election yet?
  let enrLive = false;
  try { const st = await enrSettings(config.enrBase); enrLive = st.electionType === 'G' && st.election === config.electionDate; } catch { /* keep false */ }

  const clerk = await loadClerk(state?.clerkUrl);
  // Is the clerk's page a general-election report yet? (Before Nov. 3 it's still May's primary.)
  const clerkGeneral = !!clerk.parsed && /general/i.test(clerk.parsed.meta.election || '');

  // Seats shown district-wide from the state: the fixed list, races HQ added, and any other congressional or
  // legislative race on the clerk's report (those reach past Howard County).
  const specs = [
    ...(config.stateRaces || []).map((s) => ({ id: 'state:' + s.key, seat: s.seat, name: s.name, level: s.level })),
    ...(state.addedState || []).filter((a) => a.seat).map((a) => ({ id: a.id, seat: a.seat, name: a.name, level: a.level })),
  ];
  if (clerkGeneral) {
    const have = new Set(specs.map((x) => x.seat));
    for (const r of clerkRaces(clerk.parsed, config)) {
      if (r.partial && r.seat && !have.has(r.seat)) { specs.push({ id: 'state:auto:' + r.seat, seat: r.seat, name: r.office, level: r.level }); have.add(r.seat); }
    }
  }
  const stateResults = await Promise.all(specs.map((x) => loadSeatRace(x, enrLive)));
  const found = stateResults.filter((r) => !r.missing);
  const stateRaces = found.filter((r) => r.cands.length > r.voteFor); // unopposed: never shown

  // Howard races: the clerk's report once it's the general election, the November ballot before that.
  // A district race the state hasn't posted yet keeps the clerk's numbers, labeled "Howard County only".
  const howard = clerkGeneral
    ? clerkRaces(clerk.parsed, { ...config, replaceSeats: found.map((r) => r.seat) })
    : howardBallotRaces(0);

  // civicAPI: a backup for any race the clerk or the state hasn't reported yet, and a cross-check where both have
  // numbers. The clerk (local) and the state (district and statewide) stay first.
  const civic = await civicHoward();
  const disagree = [];
  let used = 0;
  for (const r of howard) {
    const k = canonKey(r.rawOffice || String(r.id).replace(/^clerk:/, ''));
    const b = k && civic.map.get(k);
    if (!b) continue;
    r.civicId = b.id;
    if (!b.live) continue;
    const mine = sum(r.cands), theirs = sum(b.cands);
    // Whichever source has counted more votes wins, so the board never steps backward when sources trade places.
    if (theirs > mine) {
      if (mine && Math.abs(mine - theirs) > Math.max(50, 0.01 * theirs)) disagree.push({ office: r.office, clerk: mine, civic: theirs });
      const byName = new Map(b.cands.map((c) => [c.name.toLowerCase(), c]));
      const match = (c) => byName.get(String(c.name).toLowerCase()) ?? b.cands.find((x) => x.name.split(' ').pop().toLowerCase() === String(c.name).split(' ').pop().toLowerCase());
      // Keep the clerk's names when every candidate lines up; otherwise take civicAPI's list as is.
      r.cands = r.cands.length && r.cands.every(match)
        ? r.cands.map((c) => ({ ...c, votes: match(c).votes }))
        : b.cands.map((c) => ({ name: fixName(c.name), party: c.party, votes: c.votes }));
      r.backup = true; used++;
    } else if (mine && theirs && Math.abs(mine - theirs) > Math.max(50, 0.01 * Math.max(mine, theirs))) {
      disagree.push({ office: r.office, clerk: mine, civic: theirs });
    }
  }
  await Promise.all(stateRaces.map(async (r) => {
    try {
      // civicAPI is the main source for state seats; the state's own site only stands in when civicAPI has nothing.
      const cc = await seatCount(r.seat);
      if (!cc) return;
      r.civicId = cc.id;
      if (!cc.cands || !sum(cc.cands)) return;
      r.cands = withNames(r.cands, cc.cands).map((c) => ({ ...c, name: fixName(c.name) }));
      r.fromCivic = true; r.pct = cc.pct; used++;
    } catch { /* civicAPI down: the state's numbers (or the ballot) stand */ }
  }));

  // Legislative and congressional seats: until the state or civicAPI has more, show the clerk's Howard County count
  // (labeled "Howard County only") instead of zeros. The race keeps its id, so pins and TV hides still apply.
  if (clerkGeneral) {
    const local = new Map(clerkRaces(clerk.parsed, config).filter((c) => c.partial && c.seat).map((c) => [c.seat, c]));
    for (const r of stateRaces) {
      const c = local.get(r.seat);
      if (!c || sum(r.cands) || !sum(c.cands)) continue; // only while the state and civicAPI both show zeros
      const last = (n) => String(n).trim().split(/\s+/).pop().toLowerCase();
      r.cands = c.cands.map((k) => { const st = r.cands.find((x) => last(x.name) === last(k.name)); return { name: st ? st.name : k.name, party: st?.party || k.party, votes: k.votes }; });
      r.howardOnly = true; r.backup = false;
    }
  }

  return {
    meta: clerkGeneral ? clerk.meta : { election: 'General Election', status: 'Before results', reportTime: null, ballotsCast: null, registered: null },
    beforeResults: !clerkGeneral && !enrLive,
    races: [...stateRaces, ...howard],
    sources: {
      clerk: { ok: clerk.ok, general: clerkGeneral, url: clerk.url || null, custom: !!state?.clerkUrl, election: clerk.parsed?.meta?.election || null, at: clerk.at || null, error: clerk.error || null },
      civic: { ok: civic.ok, used, disagree, error: civic.error || null },
      state: { live: enrLive, missing: stateResults.filter((r) => r.missing).map((r) => r.id), stale: stateResults.filter((r) => r.stale).map((r) => r.id) },
    },
    pollSeconds: config.pollSeconds,
    builtAt: new Date().toISOString(),
  };
}
