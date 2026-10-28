// GET /api/indiana — the "Around Indiana" tab: every statewide, U.S. House, State Senate, and State House race
// that is contested in November (a Democrat and a Republican both on the ballot), plus statewide ballot questions.
//
// Which races: the Election Division's general-election candidate list (lib/ballot.js), which already reflects
// nominees picked by caucus after the primary. Once the state's results site switches to the general election,
// the numbers come from there; until then each race shows its candidates with no votes yet.
import config from '../lib/config.js';
import { enrCategories, enrCategoryRaces, enrQuestions, seatKey } from '../lib/enr.js';
import { BALLOT, isContested, GROUP_OF, officeName } from '../lib/ballot.js';
import { previewIndiana } from '../lib/preview.js';
import { seatRace } from '../lib/civicapi.js';

const ORDER = ['Statewide', 'Congress', 'State Senate', 'State House', 'Ballot questions'];
const STATE_OFFICES = /^(US Representative|United States Representative|State Senator|State Representative|Governor|Attorney General|Secretary of State|Treasurer of State|State Treasurer|Comptroller|State Comptroller|Auditor of State|US Senator|United States Senator)/i;
const district = (seat) => Number(seat.replace(/^\D+/, '')) || 0;

export default async function handler(req, res) {
  if (new URL(req.url, 'http://x').searchParams.has('sample')) {
    res.setHeader('Cache-Control', 'public, s-maxage=20');
    return res.status(200).json(previewIndiana());
  }
  try {
    let settings = null;
    try { ({ settings } = await enrCategories(config.enrBase)); } catch { /* state site down: fall back to the ballot list */ }
    const live = settings && settings.electionType === 'G' && settings.election === config.electionDate;

    // Seat -> election-night results, when the state has them.
    const results = new Map();
    let questions = [];
    if (live) {
      const { cats } = await enrCategories(config.enrBase);
      for (const cat of cats.filter((c) => STATE_OFFICES.test(c.name))) {
        const { races } = await enrCategoryRaces(config.enrBase, cat.id);
        for (const r of races) results.set(seatKey(r.title), { ...r, categoryId: cat.id });
      }
      questions = await enrQuestions(config.enrBase);
    }

    const races = [];
    const seen = new Set();
    // Every seat with a Democrat and a Republican on the November ballot.
    for (const b of BALLOT) {
      if (!isContested(b.cands)) continue;
      seen.add(b.seat);
      const r = results.get(b.seat);
      races.push({
        id: 'seat:' + b.seat,
        seat: b.seat,
        source: 'state',
        scope: GROUP_OF(b.seat) === 'Statewide' ? 'statewide' : 'district',
        group: GROUP_OF(b.seat),
        office: officeName(b.seat),
        voteFor: r?.seats || 1,
        cands: r ? r.cands : b.cands.map((c) => ({ ...c, votes: 0 })),
        ...(r ? { stateKey: `${r.categoryId}:${r.officeId}` } : {}),
      });
    }
    // On election night, anything the state reports as D vs R that the candidate list missed.
    for (const [seat, r] of results) {
      if (seen.has(seat) || !isContested(r.cands)) continue;
      races.push({ id: 'seat:' + seat, seat, source: 'state', scope: GROUP_OF(seat) === 'Statewide' ? 'statewide' : 'district', group: GROUP_OF(seat), office: officeName(seat), voteFor: r.seats, cands: r.cands, stateKey: `${r.categoryId}:${r.officeId}` });
    }
    for (const q of questions) {
      races.push({
        id: `question:${q.id}`, seat: `Q${q.id}`, source: 'state', group: 'Ballot questions', scope: 'statewide',
        office: q.title, detail: q.text, voteFor: 1,
        cands: [{ name: 'Yes', party: '', votes: q.yes }, { name: 'No', party: '', votes: q.no }],
      });
    }
    races.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || district(a.seat) - district(b.seat));
    // Link each seat to civicAPI for county breakdowns and vote timelines (optional: skipped if civicAPI is down).
    await Promise.all(races.filter((r) => r.id.startsWith('seat:')).map(async (r) => { try { r.civicId = (await seatRace(r.seat))?.id || undefined; } catch { /* no link */ } }));

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=180');
    return res.status(200).json({ live, election: settings?.election || null, races, builtAt: new Date().toISOString() });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String(err.message || err) });
  }
}
