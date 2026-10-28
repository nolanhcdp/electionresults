// GET /api/county?c=Tipton — every contested local race in one Indiana county, from civicAPI.
// Contested: a Democrat and a Republican both running, or (for nonpartisan races and questions) two or more choices.
// Votes show once Indiana's polls close and civicAPI marks the race as real (not test data).
// ?test=1 fills in civicAPI's practice numbers so the tab can be checked before election night.
import { searchCounty, liveCands, civicGet, cleanName, partyCode } from '../lib/civicapi.js';

export const COUNTIES = ['Adams', 'Allen', 'Bartholomew', 'Benton', 'Blackford', 'Boone', 'Brown', 'Carroll', 'Cass', 'Clark', 'Clay', 'Clinton', 'Crawford', 'Daviess', 'Dearborn', 'Decatur', 'DeKalb', 'Delaware', 'Dubois', 'Elkhart', 'Fayette', 'Floyd', 'Fountain', 'Franklin', 'Fulton', 'Gibson', 'Grant', 'Greene', 'Hamilton', 'Hancock', 'Harrison', 'Hendricks', 'Henry', 'Howard', 'Huntington', 'Jackson', 'Jasper', 'Jay', 'Jefferson', 'Jennings', 'Johnson', 'Knox', 'Kosciusko', 'LaGrange', 'Lake', 'LaPorte', 'Lawrence', 'Madison', 'Marion', 'Marshall', 'Martin', 'Miami', 'Monroe', 'Montgomery', 'Morgan', 'Newton', 'Noble', 'Ohio', 'Orange', 'Owen', 'Parke', 'Perry', 'Pike', 'Porter', 'Posey', 'Pulaski', 'Putnam', 'Randolph', 'Ripley', 'Rush', 'St. Joseph', 'Scott', 'Shelby', 'Spencer', 'Starke', 'Steuben', 'Sullivan', 'Switzerland', 'Tippecanoe', 'Tipton', 'Union', 'Vanderburgh', 'Vermillion', 'Vigo', 'Wabash', 'Warren', 'Warrick', 'Washington', 'Wayne', 'Wells', 'White', 'Whitley'];

const GROUPS = [
  ['County', /^(County Commissioner|County Council|Auditor|Treasurer|Recorder|Sheriff|Coroner|Surveyor|Assessor|Clerk|County)$/],
  ['Courts', /^(Judge|Judicial)$/],
  ['Cities and towns', /^(Mayor|City Council|Local)$/],
  ['Townships', /^(Township Trustee|Township Board)$/],
  ['School boards', /^School Board$/],
  ['Questions', /^Referendum$/],
];
const groupOf = (type) => (GROUPS.find(([, re]) => re.test(type)) || ['Other'])[0];
const ORDER = [...GROUPS.map(([g]) => g), 'Other'];

function contested(cands) {
  const parties = cands.map((c) => c.party);
  if (parties.includes('D') && parties.includes('R')) return true;
  return parties.every((p) => !p || p === 'I' || p === 'L') && cands.length >= 2;
}
function voteFor(r) {
  if (r.type === 'Township Board') return 3;
  if (/at large/i.test(r.election_name) && r.type === 'County Council') return 3;
  const winners = (r.candidates || []).filter((c) => c.winner).length;
  return winners > 1 ? winners : 1;
}
// At-large city and town councils elect several members, but civicAPI doesn't say how many.
const seatsUnknown = (r) => /at large/i.test(r.election_name) && r.type !== 'County Council' && voteFor(r) === 1;
const shortName = (name, county) => cleanName(name).replace(new RegExp(`^${county} County\\s+`, 'i'), 'County ').replace(new RegExp(`,?\\s*(of\\s+)?(the\\s+)?${county} County\\b`, 'i'), '').replace(/\s+Member\b/, '');

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const county = COUNTIES.find((c) => c.toLowerCase() === String(url.searchParams.get('c') || '').toLowerCase());
  if (!county) return res.status(400).json({ error: 'Pick an Indiana county.' });
  const test = url.searchParams.get('test') === '1';
  try {
    const { races = [] } = await searchCounty(county);
    const out = [];
    await Promise.all(races.map(async (r) => {
      const base = (r.candidates || []).map((c) => ({ name: cleanName(c.name), party: partyCode(c.party) }));
      if (!contested(base)) return;
      let cands, pct = 0, live = false;
      if (test) {
        const d = await civicGet(`race/${r.id}?testdata`, { ttl: 300_000 }).catch(() => null);
        cands = (d?.candidates || r.candidates).map((c) => ({ name: cleanName(c.name), party: partyCode(c.party), votes: Number(c.votes) || 0, winner: !!c.winner }));
        pct = Number(d?.percent_reporting) || 0; live = !!d;
      } else ({ cands, pct, live } = await liveCands(r));
      out.push({
        id: `county:${r.id}`, civicId: r.id, source: 'civic', county,
        office: shortName(r.election_name, county) + (seatsUnknown(r) ? ' (several seats)' : ''), group: groupOf(r.type), type: r.type,
        voteFor: voteFor(r), cands, pct, live,
      });
    }));
    out.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || a.office.localeCompare(b.office, 'en', { numeric: true }));
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ county, test, live: out.some((r) => r.live), races: out, builtAt: new Date().toISOString() });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: `civicAPI isn't answering right now (${err.message || err}).` });
  }
}
