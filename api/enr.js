// GET /api/enr            — the state's office categories (for "Add a race")
// GET /api/enr?cat=1018   — the races in one category
import config from '../lib/config.js';
import { enrCategories, enrCategoryRaces } from '../lib/enr.js';
import { isAdmin } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAdmin(req)) return res.status(401).json({ error: 'Log in on the control page first.' });
  try {
    const cat = new URL(req.url, 'http://x').searchParams.get('cat');
    if (cat) {
      const { races } = await enrCategoryRaces(config.enrBase, cat);
      return res.status(200).json({ races: races.map((r) => ({ officeId: r.officeId, title: r.title, candidates: r.cands.length, seats: r.seats })) });
    }
    const { settings, cats } = await enrCategories(config.enrBase);
    return res.status(200).json({ election: settings.election, electionType: settings.electionType, categories: cats });
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
}
