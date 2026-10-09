import config from './config.js';
import { parseReport, clerkRaces, clerkMeta, districtSpec } from './clerk.js';
import { findStateRace, findBySeat, seatKey } from './enr.js';
import { ballotSeat } from './ballot.js';

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

async function loadSeatRace(spec) {
  try {
    const hit = await findBySeat(config.enrBase, spec.seat);
    if (hit && hit.settings.electionType === 'G' && hit.settings.election === config.electionDate) {
      const race = { id: spec.id, source: 'state', office: spec.name, level: spec.level, voteFor: hit.seats, cands: hit.cands, seat: spec.seat, stateKey: `${hit.categoryId}:${hit.officeId}` };
      lastGood.state.set(spec.id, race);
      return race;
    }
  } catch (err) {
    const prev = lastGood.state.get(spec.id);
    if (prev) return { ...prev, stale: true };
  }
  // Before election night: who's on the November ballot, no votes yet.
  const b = ballotSeat(spec.seat);
  if (!b) return { missing: true, id: spec.id };
  return { id: spec.id, source: 'state', office: spec.name, level: spec.level, voteFor: 1, cands: b.cands.map((c) => ({ ...c, votes: 0 })), seat: spec.seat };
}

async function loadStateRace(spec) {
  if (spec.seat) return loadSeatRace(spec);
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
      stateKey: `${hit.categoryId}:${hit.officeId}`,
      seat: seatKey(hit.title),
      scope: /^(SOS|TRE|COMP|GOV|AG|USSEN)$/.test(seatKey(hit.title)) ? 'statewide' : 'district',
    };
    lastGood.state.set(spec.id, race);
    return race;
  } catch (err) {
    const prev = lastGood.state.get(spec.id);
    return prev ? { ...prev, stale: true } : { missing: true, id: spec.id, error: String(err.message || err) };
  }
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function buildResults(state) {
  const specs = [
    ...(config.stateRaces || []).map((s) => ({ ...s, id: 'state:' + s.key })),
    ...(state.addedState || []).map((a) => ({ id: a.id, name: a.name, level: a.level, seat: a.seat, categoryId: a.categoryId, officeId: a.officeId })),
  ];
  const [clerk, ...stateResults] = await Promise.all([loadClerk(), ...specs.map(loadStateRace)]);

  // Any other clerk contest for a district that reaches past Howard County: look it up in the state's feed too,
  // so the board shows the whole district instead of Howard's slice.
  const listed = (config.stateRaces || []).map((s) => new RegExp(s.replaces, 'i'));
  const autoSpecs = [];
  if (clerk.parsed) {
    for (const r of clerkRaces(clerk.parsed, { ...config, stateRaces: [] })) {
      if (!r.partial || listed.some((re) => re.test(r.rawOffice))) continue;
      const d = districtSpec(r.rawOffice);
      if (d) autoSpecs.push({ ...d, id: 'state:auto:' + r.rawOffice, name: r.office, level: r.level, replaces: `^${escapeRe(r.rawOffice)}$` });
    }
  }
  const autoResults = await Promise.all(autoSpecs.map(loadStateRace));
  const allResults = [...stateResults, ...autoResults];

  const found = allResults.filter((r) => !r.missing);
  const stateRaces = found.filter((r) => r.cands.length > r.voteFor);
  const missing = allResults.filter((r) => r.missing).map((r) => r.id);
  // Only drop a clerk contest once the state actually has the whole-district version.
  // Until then the clerk's numbers stay up, labeled "Howard County only".
  const foundIds = new Set(found.map((r) => r.id));
  const replacing = [...(config.stateRaces || []).map((s) => ({ ...s, id: 'state:' + s.key })), ...autoSpecs].filter((s) => foundIds.has(s.id));
  const clerkList = clerk.parsed ? clerkRaces(clerk.parsed, { ...config, stateRaces: replacing }) : [];

  return {
    meta: clerk.meta,
    races: [...stateRaces, ...clerkList],
    sources: {
      clerk: { ok: clerk.ok, at: clerk.at || null, error: clerk.error || null },
      state: { missing, stale: allResults.filter((r) => r.stale).map((r) => r.id) },
    },
    pollSeconds: config.pollSeconds,
    builtAt: new Date().toISOString(),
  };
}
