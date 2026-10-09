// GET /api/enr            — groups for "Add a race" in /control
// GET /api/enr?cat=Congress — the seats in that group with a Democrat AND a Republican on the November ballot
import { BALLOT, isContested, GROUP_OF, officeName } from '../lib/ballot.js';
import { isAdmin } from '../lib/auth.js';

const GROUPS = ['Statewide', 'Congress', 'State Senate', 'State House'];
const num = (seat) => Number(seat.replace(/^\D+/, '')) || 0;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAdmin(req)) return res.status(401).json({ error: 'Log in on the control page first.' });
  const contested = BALLOT.filter((b) => isContested(b.cands));
  const cat = new URL(req.url, 'http://x').searchParams.get('cat');
  if (cat) {
    const races = contested.filter((b) => GROUP_OF(b.seat) === cat).sort((a, b) => num(a.seat) - num(b.seat))
      .map((b) => ({ seat: b.seat, title: officeName(b.seat), candidates: b.cands.map((c) => `${c.name} (${c.party})`).join(', ') }));
    return res.status(200).json({ races });
  }
  return res.status(200).json({ categories: GROUPS.map((g) => ({ id: g, name: `${g} (${contested.filter((b) => GROUP_OF(b.seat) === g).length})` })) });
}
