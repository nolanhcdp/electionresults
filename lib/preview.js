// November preview: the real November 2026 ballot with made-up vote counts, so the TV, phones, and control page
// can be seen working before election night. Turned on per page with ?sample in the address; it never touches
// the real board.
//
// A fake election night runs on a 16-minute loop: no votes, then a big early-vote drop, then vote centers
// reporting every minute until everything is in. Then it starts over.
import { readFileSync } from 'node:fs';
import config from './config.js';
import { BALLOT, isContested, GROUP_OF, officeName, ballotSeat } from './ballot.js';

const HOWARD = JSON.parse(readFileSync(new URL('./ballot-howard-2026.json', import.meta.url), 'utf8'));
const CURVE = [0, 0.34, 0.37, 0.41, 0.46, 0.51, 0.56, 0.61, 0.67, 0.73, 0.79, 0.85, 0.9, 0.94, 0.98, 1];
const STEP_MS = 60_000;

function hash(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
function rand(seed) { return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function previewClock(now = Date.now()) {
  const step = Math.floor(now / STEP_MS) % CURVE.length;
  const mins = 18 * 60 + step * 12; // 6:00 PM, then a report every 12 "minutes"
  const h = Math.floor(mins / 60), m = mins % 60;
  return { step, p: CURVE[step], reportTime: `11/03/2026 ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` };
}

const fixName = (n) => config.candidates?.[n.toUpperCase()] || n;

// Votes for one race at progress p. Early vote leans Democratic and the lead shifts as vote centers come in.
function simulate(key, cands, seats, fullTurnout, p) {
  const r = rand(hash(key));
  const dBase = 0.36 + r() * 0.22;
  const dShare = Math.min(0.75, dBase + 0.05 * (1 - p));
  const others = cands.filter((c) => c.party !== 'D' && c.party !== 'R');
  const otherShare = others.length ? 0.02 + r() * 0.03 : 0;
  const nD = cands.filter((c) => c.party === 'D').length || 1, nR = cands.filter((c) => c.party === 'R').length || 1;
  const votesCast = fullTurnout * p * seats;
  return cands.map((c) => {
    const jitter = 0.92 + r() * 0.16;
    const share = c.party === 'D' ? (dShare * (1 - otherShare)) / nD : c.party === 'R' ? ((1 - dShare) * (1 - otherShare)) / nR : otherShare / others.length;
    return { name: fixName(c.name), party: c.party, votes: Math.round(votesCast * share * jitter) };
  });
}

function turnoutFor(seat) {
  if (/^CD/.test(seat)) return 290_000;
  if (/^SD/.test(seat)) return 62_000;
  if (/^HD/.test(seat)) return 27_000;
  return 2_300_000; // statewide
}

function howardOffice(title) {
  return title
    .replace(/^Howard County Circuit Court Clerk$/, 'County Clerk')
    .replace(/^Howard County /, 'County ')
    .replace(/, Howard County$/, '')
    .replace(/ Board Member$/, ' Board');
}
function howardTurnout(title) {
  if (/Council, District/.test(title)) return 11_000;
  if (/^Center Township/.test(title)) return 16_000;
  if (/Township/.test(title)) return 3_500;
  return 44_000; // countywide
}

// The whole-district races on the Howard board, from the November ballot, at progress p (0 = no votes yet).
const SEAT_OF = { cd5: 'CD5', sos: 'SOS', treas: 'TRE', comp: 'COMP', ss21: 'SD21', sh30: 'HD30', sh38: 'HD38' };
export function stateBallotRaces(state, p) {
  const races = [];
  const scope = (seat) => (GROUP_OF(seat) === 'Statewide' ? 'statewide' : 'district');
  for (const s of config.stateRaces || []) {
    const b = ballotSeat(s.seat);
    if (!b || !isContested(b.cands)) continue;
    races.push({ id: 'state:' + s.key, source: 'state', scope: scope(b.seat), office: s.name, level: s.level, voteFor: 1, seat: b.seat, cands: simulate(b.seat, b.cands, 1, turnoutFor(b.seat), p) });
  }
  for (const a of state.addedState || []) {
    const b = a.seat && ballotSeat(a.seat);
    if (b) races.push({ id: a.id, source: 'state', scope: scope(b.seat), office: a.name, level: a.level, voteFor: 1, seat: b.seat, cands: simulate(b.seat, b.cands, 1, turnoutFor(b.seat), p) });
  }
  return races;
}

// Howard County races from the November candidate list (contested only), at progress p.
export function howardBallotRaces(p) {
  const races = [];
  for (const h of HOWARD) {
    if (h.cands.length <= h.seats) continue;
    const cands = h.cands.map(([name, party]) => ({ name, party }));
    races.push({
      id: 'clerk:' + h.title, source: 'clerk', office: howardOffice(h.title),
      level: /Township|Town /.test(h.title) ? 'Township and town' : 'County',
      voteFor: h.seats, cands: simulate(h.title, cands, h.seats, howardTurnout(h.title), p),
    });
  }
  return races;
}

export function previewResults(state) {
  const { p, reportTime } = previewClock();
  return {
    meta: { election: 'General Election (preview)', status: 'PREVIEW', reportTime: p ? reportTime : null, ballotsCast: Math.round(44_000 * p), registered: null },
    races: [...stateBallotRaces(state, p), ...howardBallotRaces(p)],
    sources: { clerk: { ok: true, at: new Date().toISOString(), error: null }, state: { missing: [], stale: [] } },
    preview: true,
    pollSeconds: 20,
    builtAt: `preview-${Math.floor(Date.now() / STEP_MS)}`,
  };
}

export function previewIndiana() {
  const { p } = previewClock();
  const ORDER = ['Statewide', 'Congress', 'State Senate', 'State House'];
  const num = (seat) => Number(seat.replace(/^\D+/, '')) || 0;
  const races = BALLOT.filter((b) => isContested(b.cands)).map((b) => ({
    id: 'seat:' + b.seat, seat: b.seat, source: 'state', scope: GROUP_OF(b.seat) === 'Statewide' ? 'statewide' : 'district',
    group: GROUP_OF(b.seat), office: officeName(b.seat), voteFor: 1, cands: simulate(b.seat, b.cands, 1, turnoutFor(b.seat), p),
  }));
  races.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || num(a.seat) - num(b.seat));
  return { live: true, preview: true, election: '11/03/2026', races, builtAt: `preview-${Math.floor(Date.now() / STEP_MS)}` };
}
