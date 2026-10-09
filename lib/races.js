import config from './config.js';
import { parseReport, clerkRaces, clerkMeta } from './clerk.js';
import { findStateRace } from './enr.js';

const PARTY_LETTER = { DEM: 'D', REP: 'R', LIB: 'L', IND: 'I' };

// Last good answer from each source, so a hiccup on either site never blanks the board.
const lastGood = { clerk: null, state: new Map() };

async function loadClerk() {
  const url = process.env.CLERK_URL || config.clerkUrl;
  try {
    const r = await fetch(url, { headers: { 'cache-control': 'no-cache', 'user-agent': 'hcdp-election-night/1.0' } });
    if (!r.ok) throw new Error(`Clerk's page answered ${r.status}`);
    const parsed = parseReport(await r.text());
    if (!parsed.contests.length) throw new Error("Clerk's report had no contests");
    lastGood.clerk = { parsed, meta: clerkMeta(parsed), at: new Date().toISOString() };
    return { ...lastGood.clerk, ok: true };
  } catch (err) {
    if (lastGood.clerk) return { ...lastGood.clerk, ok: false, error: String(err.message || err) };
    return { parsed: null, meta: {}, ok: false, error: String(err.message || err) };
  }
}

async function loadStateRace(spec) {
  try {
    const hit = await findStateRace(config.enrBase, spec);
    if (!hit) return { missing: true, id: spec.id };
    let cands = hit.cands;
    // Primary files list every party's candidates in one race; keep only ours.
    if (hit.settings.electionType === 'P') {
      const keep = (config.primaryParties || []).map((p) => PARTY_LETTER[p] || p);
      cands = cands.filter((c) => keep.includes(c.party));
    }
    const race = {
      id: spec.id,
      source: 'state',
      office: spec.name || hit.title,
      level: spec.level || 'Statehouse',
      voteFor: hit.seats,
      cands: cands.map((c) => ({ name: config.candidates?.[c.name.toUpperCase()] || c.name, party: c.party, votes: c.votes })),
      stateTitle: hit.title,
    };
    lastGood.state.set(spec.id, race);
    return race;
  } catch (err) {
    const prev = lastGood.state.get(spec.id);
    return prev ? { ...prev, stale: true } : { missing: true, id: spec.id, error: String(err.message || err) };
  }
}

export async function buildResults(state) {
  const specs = [
    ...(config.stateRaces || []).map((s) => ({ ...s, id: 'state:' + s.key })),
    ...(state.addedState || []).map((a) => ({ id: a.id, name: a.name, level: a.level, categoryId: a.categoryId, officeId: a.officeId })),
  ];
  const [clerk, ...stateResults] = await Promise.all([loadClerk(), ...specs.map(loadStateRace)]);

  const found = stateResults.filter((r) => !r.missing);
  const stateRaces = found.filter((r) => r.cands.length > r.voteFor);
  const missing = stateResults.filter((r) => r.missing).map((r) => r.id);
  // Only drop a clerk contest when the state actually has the district-wide version.
  const foundIds = new Set(found.map((r) => r.id));
  const replacing = (config.stateRaces || []).filter((s) => foundIds.has('state:' + s.key));
  const clerkList = clerk.parsed ? clerkRaces(clerk.parsed, { ...config, stateRaces: replacing }) : [];

  return {
    meta: clerk.meta,
    races: [...stateRaces, ...clerkList],
    sources: {
      clerk: { ok: clerk.ok, at: clerk.at || null, error: clerk.error || null },
      state: { missing, stale: stateResults.filter((r) => r.stale).map((r) => r.id) },
    },
    pollSeconds: config.pollSeconds,
    builtAt: new Date().toISOString(),
  };
}
