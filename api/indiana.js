// GET /api/indiana — every contested statewide office, U.S. House, State Senate, and State House race in Indiana,
// plus statewide ballot questions, district-wide from the
// Secretary of State's feed. Phones show these on the "Around Indiana" tab; HQ can pull any of them onto the TV
// from /control. Cached at Vercel's edge for a minute; the state refreshes every two.
import config from '../lib/config.js';
import { enrCategories, enrCategoryRaces, enrQuestions } from '../lib/enr.js';

const GROUPS = [
  { group: 'Statewide', re: /^(Governor|Attorney General|Secretary of State|Treasurer of State|State Treasurer|Comptroller|State Comptroller|Auditor of State|Superintendent|US Senator|United States Senator)/i, label: null },
  { group: 'Congress', re: /^US Representative|United States Representative/i, label: 'U.S. House' },
  { group: 'State Senate', re: /^State Senator/i, label: 'State Senate' },
  { group: 'State House', re: /^State Representative/i, label: 'State House' },
];
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };
const PARTY_LETTER = { DEM: 'D', REP: 'R', LIB: 'L', IND: 'I' };

function districtOf(title) {
  const m = title.match(/District 0*(\d+)/i) || title.match(/\((\d+)\)/);
  if (m) return Number(m[1]);
  const w = title.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\s+District/i);
  return w ? ORD[w[1].toLowerCase()] : null;
}

export default async function handler(req, res) {
  try {
    const { settings, cats } = await enrCategories(config.enrBase);
    const keep = (config.primaryParties || []).map((p) => PARTY_LETTER[p] || p);
    const races = [];
    for (const g of GROUPS) {
      for (const cat of cats.filter((c) => g.re.test(c.name))) {
        const { races: list } = await enrCategoryRaces(config.enrBase, cat.id);
        for (const r of list) {
          const cands = settings.electionType === 'P' ? r.cands.filter((c) => keep.includes(c.party)) : r.cands;
          if (cands.length <= r.seats) continue; // unopposed: never shown
          const n = districtOf(r.title);
          races.push({
            id: `state:${cat.id}:${r.officeId}`,
            stateKey: `${cat.id}:${r.officeId}`,
            categoryId: cat.id,
            officeId: r.officeId,
            source: 'state',
            group: g.group,
            district: n,
            office: g.label && n ? `${g.label}, District ${n}` : r.title,
            scope: g.group === 'Statewide' ? 'statewide' : 'district',
            voteFor: r.seats,
            cands: cands.map((c) => ({ name: c.name, party: c.party, votes: c.votes })),
          });
        }
      }
    }
    for (const q of await enrQuestions(config.enrBase)) {
      races.push({
        id: `question:${q.id}`, stateKey: `question:${q.id}`, source: 'state', group: 'Ballot questions', scope: 'statewide',
        office: q.title, detail: q.text, voteFor: 1,
        cands: [{ name: 'Yes', party: '', votes: q.yes }, { name: 'No', party: '', votes: q.no }],
      });
    }
    const ORDER = [...GROUPS.map((g) => g.group), 'Ballot questions'];
    races.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || (a.district ?? 999) - (b.district ?? 999));
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=180');
    return res.status(200).json({ election: settings.election, electionType: settings.electionType, races, builtAt: new Date().toISOString() });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String(err.message || err) });
  }
}
