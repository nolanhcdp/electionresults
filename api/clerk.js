// GET /api/clerk — the Howard County clerk's whole summary report, every contest as posted (including unopposed
// races, public questions, and straight-ticket votes), for the /howard-results dashboard.
// Cached at Vercel's edge for 30 seconds, so the clerk's page is read at most twice a minute however many people watch.
import config from '../lib/config.js';
import { parseReport, clerkMeta, splitParty, prettyOffice, levelOf, titleCase } from '../lib/clerk.js';
import { getState, defaultState } from '../lib/db.js';

const SKIP = /^(NO CANDIDATE FILED|Write-?in.*)$/i;

export default async function handler(req, res) {
  let state;
  try { state = await getState(); } catch { state = defaultState(); }
  const url = state?.clerkUrl || process.env.CLERK_URL || config.clerkUrl;
  try {
    const r = await fetch(url, { headers: { 'cache-control': 'no-cache', 'user-agent': 'hcdp-election-night/1.0' } });
    if (!r.ok) throw new Error(`Clerk's page answered ${r.status}`);
    const p = parseReport(await r.text());
    if (!p.contests.length) throw new Error("Clerk's report had no contests");
    const contests = p.contests.map((c) => ({
      id: c.id,
      office: /^STRAIGHT PARTY/i.test(c.office) ? 'Straight-ticket votes' : prettyOffice(c.office),
      level: levelOf(c.office),
      voteFor: c.voteFor,
      overvotes: c.overvotes,
      undervotes: c.undervotes,
      total: c.total,
      cands: c.candidates.filter((k) => !SKIP.test(k.name)).map((k) => {
        const [raw, party] = splitParty(k.name);
        const sp = raw.match(/^(DEMOCRATIC|REPUBLICAN|LIBERTARIAN)( PARTY)?$/i);
        const name = sp ? titleCase(raw) : config.candidates?.[raw] || titleCase(raw);
        return { name, party: party || (sp ? { DEMOCRATIC: 'D', REPUBLICAN: 'R', LIBERTARIAN: 'L' }[sp[1].toUpperCase()] : ''), votes: k.votes };
      }),
    }));
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    return res.status(200).json({ meta: clerkMeta(p), statistics: p.statistics, contests, url, builtAt: new Date().toISOString() });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String(err.message || err), url });
  }
}
